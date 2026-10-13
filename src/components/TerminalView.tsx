import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useAppStore } from '@/store/useAppStore'
import { ptyClient } from '@/lib/ptyClient'
import { MockPty, type MockTool } from '@/lib/mockPty'
import { createTranscriptBuffer } from '@/lib/transcriptBuffer'
import { createNativeSessionLookup } from '@/lib/nativeSessionLookup'
import { syncTerminalViewport } from '@/lib/terminalViewport'
import { createConversationInputTracker } from '@/lib/sessionLifecycle'
import { agentById, buildLaunchArgs, terminalCompatibilityEnv, usesInitialPromptStdin } from '@/lib/agents'
import { historyRootTool, usesCurrentEntryConfig } from '@/lib/agentFamily'
import { resolveCurrentLaunchConfig } from '@/lib/agentLaunch'
import {
  isLatestLaunchAttempt,
  markLaunchAttemptCommitted,
  revertLaunchAttemptIfLatest,
} from '@/lib/launchAttempts'
import { quoteForShell } from '@/lib/shellQuote'
import { handleTerminalKeyEvent, shouldBlockTerminalMouseMode } from '@/lib/terminalKeyHandler'
import { handleTerminalContextMenu, pasteTerminalText, suppressTerminalRightMouseEvent } from '@/lib/terminalPaste'
import { registerTerminalTarget } from '@/lib/terminalRegistry'
import type { PermissionChoice, TerminalTab } from '@/types'
import { TerminalComposer } from './TerminalComposer'
import { composerPaste, composerPayload, promptCanReceive, promptHasDraft, supportsComposer, terminalHasMenu } from '@/lib/terminalComposer'
import { emptyTerminalDraft, type ImageAttachment } from '@/lib/attachments'
import { flushStorageWrites } from '@/lib/sqliteStorage'
import { nativeInputRegions, visibleTerminalSelection, type PendingNativeInput } from '@/lib/terminalPresentation'

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function termTheme() {
  return {
    background: cssVar('--term-bg') || '#0b0e12',
    foreground: cssVar('--term-fg') || '#e6edf3',
    cursor: cssVar('--term-cursor') || '#e6edf3',
    cursorAccent: cssVar('--term-bg') || '#0b0e12',
    selectionBackground: cssVar('--accent') || '#4dabf7',
    black: '#0b0e12',
    red: '#ff6b6b',
    green: '#51cf66',
    yellow: '#ffd43b',
    blue: '#4dabf7',
    magenta: '#cc8ef5',
    cyan: '#74c0fc',
    white: '#e6edf3',
    brightBlack: '#6b7a8a',
    brightRed: '#ff8787',
    brightGreen: '#69db7c',
    brightYellow: '#ffe066',
    brightBlue: '#74c0fc',
    brightMagenta: '#dda0dd',
    brightCyan: '#99e9f2',
    brightWhite: '#ffffff',
  }
}

/** 单个终端实例。Electron 下接真实 PTY（node-pty）；web 回退 MockPty。inactive 时隐藏但保留回滚缓冲。 */
export function TerminalView({ terminal, active, focused }: { terminal: TerminalTab; active: boolean; focused?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const pasteTargetRef = useRef<{ paste: (text: string) => boolean; focus: () => void; getSelection: () => string } | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const resolveTheme = useAppStore((s) => s.resolveTheme)
  const themeKey = resolveTheme()
  const reviveTerminal = useAppStore((s) => s.reviveTerminal)
  const family = useAppStore((s) => terminal.tool ? agentById(terminal.tool, s.settings.customAgents ?? [])?.sourceFamily || terminal.tool : undefined)
  const enhanced = ptyClient.isReal && terminal.kind === 'ai' && supportsComposer(family)
  const [nativeMode, setNativeMode] = useState(false)
  const [menuMode, setMenuMode] = useState(false)
  const [processReady, setProcessReady] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const modeRef = useRef({ enhanced, nativeMode, menuMode, active, focused })
  modeRef.current = { enhanced, nativeMode, menuMode, active, focused }
  const nativeInputDirty = useRef(false)
  const generatedInput = useRef(false)
  const outputVersion = useRef(0)
  const lastOutputAt = useRef(0)
  const stagedImageIds = useRef<string[]>([])
  const pendingInput = useRef<PendingNativeInput>()
  const refreshPresentation = useRef<() => void>(() => {})
  const previousMenu = useRef(false)
  const [inputMasks, setInputMasks] = useState<{ top: number; left: number; width: number; height: number; background: string }[]>([])
  const outputOnly = enhanced && !nativeMode && !menuMode && !terminal.orphaned

  const insertDraft = (text: string) => {
    const st = useAppStore.getState()
    const draft = st.terminalDrafts[terminal.id] ?? emptyTerminalDraft
    st.setTerminalDraft(terminal.id, { ...draft, text: draft.text + text })
    if (modeRef.current.menuMode) termRef.current?.focus()
    else inputRef.current?.focus()
    return true
  }

  const send = async (text: string, images: ImageAttachment[]): Promise<boolean> => {
    const term = termRef.current
    const st = useAppStore.getState()
    const processId = ptyClient.processId(terminal.id)
    const sameProcess = () => !!processId && ptyClient.processId(terminal.id) === processId && termRef.current === term
    if (!term || terminal.orphaned || !ptyClient.hasProcess(terminal.id) || !terminal.sessionId || !st.sessions.some((s) => s.id === terminal.sessionId)) {
      throw new Error('终端未就绪或会话已结束，草稿已保留')
    }
    const settleStarted = Date.now()
    while (Date.now() - lastOutputAt.current < 150 && Date.now() - settleStarted < 600 && sameProcess()) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    if (nativeInputDirty.current || !promptCanReceive(term, family!) || Date.now() - lastOutputAt.current < 150) {
      throw new Error('CLI 尚未回到空白输入提示，或原生输入有未提交内容。请使用“原生终端操作”完成菜单、清空输入后返回；草稿已保留')
    }
    if (/^\s*[!/]/.test(text)) throw new Error('CLI 命令与 Shell 模式请在“原生终端操作”中输入，底部草稿已保留')
    const paths = await Promise.all(images.map(async (image) => (await window.ringcode!.attachmentRead(image.id)).path))
    const message = composerPayload(text, paths)
    const payload = composerPaste(message, family!, window.ringcode?.platform === 'win32')
    await flushStorageWrites()
    // Reading images/storage is asynchronous. Recheck the exact process and prompt before writing.
    if (!sameProcess() || !useAppStore.getState().terminals.some((t) => t.id === terminal.id && t.sessionId === terminal.sessionId) || !promptCanReceive(term, family!) || nativeInputDirty.current) {
      throw new Error('终端状态已改变，草稿已保留')
    }
    const before = outputVersion.current
    stagedImageIds.current = images.map((image) => image.id)
    pendingInput.current = { text: message, paths }
    refreshPresentation.current()
    try {
      generatedInput.current = true
      try { term.input(payload) } finally { generatedInput.current = false }
      // Wait for a parsed CLI repaint before emitting Enter; never concatenate the two writes.
      const start = Date.now()
      while (Date.now() - start < 2_000 && sameProcess()) {
        if (outputVersion.current > before && Date.now() - lastOutputAt.current >= 100 && promptHasDraft(term, family!, message, paths)) break
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      if (!sameProcess() || outputVersion.current === before || !promptHasDraft(term, family!, message, paths) || !useAppStore.getState().terminals.some((t) => t.id === terminal.id && t.sessionId === terminal.sessionId)) {
        nativeInputDirty.current = true
        setNativeMode(true)
        throw new Error('未确认 CLI 接收文本，未自动提交。请在原生终端检查已粘贴内容；草稿已保留')
      }
      useAppStore.getState().retainSessionImages(terminal.sessionId, images.map((image) => image.id))
      await flushStorageWrites()
      if (!sameProcess() || !promptHasDraft(term, family!, message, paths)) {
        nativeInputDirty.current = true
        setNativeMode(true)
        throw new Error('CLI 状态已改变，未自动提交；请在原生终端检查，草稿已保留')
      }
      generatedInput.current = true
      try { term.input('\r') } finally { generatedInput.current = false }
      stagedImageIds.current = []
      // Delivery to PTY is not an acknowledgement that the Agent has read the image.
      useAppStore.getState().showToast('已提交给 CLI', 'success')
      return true
    } finally {
      pendingInput.current = undefined
      refreshPresentation.current()
    }
  }

  useEffect(() => {
    const term = new Terminal({
      fontFamily: 'Cascadia Mono, Consolas, "Courier New", monospace',
      fontSize: 14,
      lineHeight: 1,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'block',
      theme: termTheme(),
      allowProposedApi: true,
      scrollback: 5000,
      convertEol: false,
      windowsPty: { backend: 'conpty', buildNumber: 22621 },
      rescaleOverlappingGlyphs: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    // xterm 默认把 Ctrl+V 转成控制字符 0x16；交回 Chromium 后会触发
    // xterm 自带的 paste 事件，从而让不处理该控制字符的 CLI 也能粘贴。
    term.attachCustomKeyEventHandler((event) => {
      const mode = modeRef.current
      if (mode.enhanced && !mode.nativeMode) {
        if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'c') {
          if (event.type === 'keydown') {
            event.preventDefault()
            const selection = visibleTerminalSelection(term, nativeInputRegions(term, family!, pendingInput.current))
            if (selection) window.ringcode?.writeClipboardText(selection)
          }
          return false
        }
        if (!mode.menuMode && event.type === 'keydown' && !event.ctrlKey && !event.altKey && !event.metaKey && (event.key.length === 1 || event.key === 'Enter' || event.key === 'Backspace')) {
          event.preventDefault()
          if (event.key.length === 1) insertDraft(event.key)
          else inputRef.current?.focus()
          return false
        }
      }
      return handleTerminalKeyEvent(event)
    })
    if (!containerRef.current) {
      term.dispose()
      return
    }
    term.open(containerRef.current)
    const appState = useAppStore.getState()
    const terminalAgent = terminal.tool
      ? agentById(terminal.tool, appState.settings.customAgents ?? [])
      : undefined
    const terminalFamily = terminalAgent?.sourceFamily || terminal.tool
    const keepLocalTextSelection = supportsComposer(terminalFamily) || terminalFamily === 'antigravity'
    const mouseModeSet = keepLocalTextSelection
      ? term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, shouldBlockTerminalMouseMode)
      : undefined
    const mouseModeReset = keepLocalTextSelection
      ? term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, shouldBlockTerminalMouseMode)
      : undefined
    termRef.current = term
    fitRef.current = fit
    const pasteTarget = {
      paste: (text: string) => {
        if (modeRef.current.enhanced && !modeRef.current.nativeMode) return insertDraft(text)
        const pasted = pasteTerminalText(term, text, terminal.kind === 'ai' ? terminalFamily : undefined)
        if (!pasted) useAppStore.getState().showToast('当前 CLI 未启用安全多行粘贴，已阻止自动发送；请等待其启动完成后重试', 'info')
        return pasted
      },
      focus: () => modeRef.current.enhanced && !modeRef.current.nativeMode && !modeRef.current.menuMode ? inputRef.current?.focus() : term.focus(),
      getSelection: () => modeRef.current.enhanced && !modeRef.current.nativeMode && !modeRef.current.menuMode
        ? visibleTerminalSelection(term, nativeInputRegions(term, terminalFamily!, pendingInput.current)) : term.getSelection(),
    }
    pasteTargetRef.current = pasteTarget
    const unregisterTarget = registerTerminalTarget(terminal.id, {
      paste: (text) => modeRef.current.enhanced ? insertDraft(text) : pasteTarget.paste(text),
      focus: pasteTarget.focus,
      dispose: () => ptyClient.dispose(terminal.id),
    })

    let cleanup: (() => void) | undefined
    let disposed = false
    let initialPromptTimer: ReturnType<typeof setTimeout> | undefined
    let initialPromptSent = false
    const conversationInput = createConversationInputTracker()

    let sawOutput = false
    let presentationFrame = 0
    let viewportFrame = 0
    const updatePresentation = () => {
      const readonly = modeRef.current.enhanced && !modeRef.current.nativeMode && !modeRef.current.menuMode
      if (term.options.cursorBlink === readonly) term.options.cursorBlink = !readonly
      if (term.textarea) { term.textarea.readOnly = readonly; term.textarea.tabIndex = readonly ? -1 : 0 }
      if (presentationFrame) return
      presentationFrame = requestAnimationFrame(() => {
        presentationFrame = 0
        if (disposed || !containerRef.current) return
        const mode = modeRef.current, readonly = mode.enhanced && !mode.nativeMode && !mode.menuMode
        const screen = containerRef.current.querySelector('.xterm-screen')?.getBoundingClientRect()
        const frame = containerRef.current.getBoundingClientRect(), b = term.buffer.active
        const regions = readonly && screen?.height ? nativeInputRegions(term, terminalFamily!, pendingInput.current) : []
        const masks = regions.flatMap((r) => {
          const start = Math.max(r.startRow, b.viewportY), end = Math.min(r.endRow + 1, b.viewportY + term.rows)
          const left = Math.max(0, r.startColumn), right = Math.min(term.cols, r.endColumn)
          if (end <= start || right <= left || !screen) return []
          const row = containerRef.current?.querySelector('.xterm-rows')?.children[Math.max(0, start - b.viewportY - 1)]
          const span = row?.querySelector('span'), viewport = containerRef.current?.querySelector('.xterm-viewport')
          const cellBackground = span ? getComputedStyle(span).backgroundColor : ''
          const viewportBackground = viewport ? getComputedStyle(viewport).backgroundColor : ''
          const opaque = (color: string) => color && color !== 'transparent' && !color.endsWith(', 0)')
          const background = opaque(cellBackground) ? cellBackground : opaque(viewportBackground) ? viewportBackground : termTheme().background
          return [{ top: screen.top - frame.top + (start - b.viewportY) * screen.height / term.rows,
            left: screen.left - frame.left + left * screen.width / term.cols,
            width: (right - left) * screen.width / term.cols,
            height: (end - start) * screen.height / term.rows, background }]
        })
        setInputMasks((previous) => JSON.stringify(previous) === JSON.stringify(masks) ? previous : masks)
      })
    }
    refreshPresentation.current = updatePresentation
    const rendered = term.onRender(updatePresentation), scrolled = term.onScroll(updatePresentation)
    nativeInputDirty.current = false
    stagedImageIds.current = []
    setProcessReady(false)
    modeRef.current.menuMode = false
    setMenuMode(false)
    const parsed = term.onWriteParsed(() => {
      outputVersion.current++
      lastOutputAt.current = Date.now()
      if (!viewportFrame) viewportFrame = requestAnimationFrame(() => {
        viewportFrame = 0
        if (!disposed && containerRef.current?.clientWidth) syncTerminalViewport(term)
      })
      updatePresentation()
      const mode = modeRef.current
      if (!mode.enhanced) return
      const menu = terminalHasMenu(term, terminalFamily)
      if (menu === mode.menuMode) return
      // Update the key-routing ref before React renders or focus generates terminal events.
      mode.menuMode = menu
      setMenuMode(menu)
      if (mode.active && mode.focused !== false && !mode.nativeMode) {
        if (menu) { term.scrollToBottom(); term.focus() }
      }
    })

    const fail = (err: unknown) => {
      if (disposed) return
      const msg = err instanceof Error ? err.message : String(err)
      try {
        term.write(`\r\n\x1b[31m[启动失败] ${msg}\x1b[0m\r\n`)
      } catch {
        /* xterm 可能已销毁 */
      }
      const app = useAppStore.getState()
      app.showToast(`启动失败：${msg}`, 'error')
      if (terminal.sessionId) app.setSessionStatus(terminal.sessionId, 'failed')
    }

    const commitLaunchEntry = () => {
      if (!terminal.sessionId || !terminal.tool) return
      if (terminal.launchAttemptId && !isLatestLaunchAttempt(terminal.sessionId, terminal.launchAttemptId)) return
      markLaunchAttemptCommitted(terminal.launchAttemptId)
      const app = useAppStore.getState()
      const extra = app.settings.customAgents ?? []
      if (!usesCurrentEntryConfig(terminal.tool, extra)) return
      const sess = app.sessions.find((item) => item.id === terminal.sessionId)
      const profile = app.getProfileForTool(terminal.tool, sess?.workspaceId || app.activeWorkspaceId || undefined)
      app.commitSessionLaunch(terminal.sessionId, {
        lastCloneId: terminal.tool,
        profileId: profile?.id,
        permission: terminal.permission,
      })
    }

    const spawnReal = async () => {
      const app = useAppStore.getState()
      const ws = app.workspaces.find((w) => w.id === app.activeWorkspaceId)
      const sess = terminal.sessionId ? app.sessions.find((s) => s.id === terminal.sessionId) : undefined
      // 优先用会话自身 cwd（恢复磁盘历史会话时需在原项目目录起 claude --resume）
      const cwd = sess?.cwd || ws?.path || ''
      let exe = ''
      let args: string[] = []
      const env: Record<string, string> = {}
      const cols = Math.max(20, term.cols || 80)
      const rows = Math.max(8, term.rows || 24)
      const action = terminal.action ?? (terminal.resume ? 'resume' : 'new')
      const sourceNativeSessionId = terminal.sourceNativeSessionId ?? (action === 'resume' ? sess?.nativeSessionId : undefined)
      let promptViaStdin = false

      const roots = [...new Set([...app.workspaces.map((w) => w.path), cwd].filter(Boolean))]
      try {
        await window.ringcode?.setWorkspaceRoots?.(roots)
      } catch {
        /* 主进程稍后仍会校验 cwd */
      }
      if (disposed) return

      try {
        if (terminal.kind === 'ai' && terminal.tool) {
          const extra = app.settings.customAgents ?? []
          const agent = agentById(terminal.tool, extra)
          if (agent) promptViaStdin = usesInitialPromptStdin(agent)
          const family = agent?.sourceFamily || terminal.tool
          Object.assign(env, terminalCompatibilityEnv(terminal.tool, terminal.id, family))
          const current = usesCurrentEntryConfig(terminal.tool, extra)
          const profile = current
            ? app.getProfileForTool(terminal.tool, sess?.workspaceId || app.activeWorkspaceId || undefined)
            : sess?.profileId
              ? app.getProfile(sess.profileId) ?? app.getProfileForTool(terminal.tool, sess.workspaceId || undefined)
              : app.getProfileForTool(terminal.tool, app.activeWorkspaceId || undefined)
          const cfg = agent && current
            ? resolveCurrentLaunchConfig({
                agent,
                profile,
                permissionByAgent: app.settings.launchPermissionByAgent ?? {},
              })
            : undefined
          if (cfg && 'ok' in cfg && cfg.ok === false) {
            throw new Error('缺少有效的启动配置')
          }
          const resolved = cfg && !('ok' in cfg) ? cfg : undefined
          exe = resolved?.command || profile?.command || agent?.command || terminal.tool
          const permission: PermissionChoice | undefined = current
            ? terminal.permission ?? resolved?.permission
            : terminal.permission ?? sess?.launchPermission ?? (terminal.autoMode ? 'auto' : undefined)
          args = buildLaunchArgs(
            agent ?? {
              id: terminal.tool,
              name: terminal.tool,
              command: exe,
              icon: './logo.png',
              accent: 'var(--surface-2)',
              resumeFlag: '--resume',
              historyRoots: [],
            },
            current ? '' : profile?.args || '',
            {
              permission,
              action,
              nativeSessionId: sourceNativeSessionId,
              initialPrompt: action === 'new' ? terminal.initialPrompt : undefined,
              model: resolved?.model ?? profile?.model,
              modelMode: resolved?.modelMode ?? profile?.modelMode,
              codexProfile: resolved?.codexProfile,
              codexProvider: resolved?.codexProvider,
            },
          )
          if (!current && profile?.envs) {
            for (const e of profile.envs) {
              if (e.sensitive) continue
              if (e.value) env[e.key] = e.value
            }
          }
          if (resolved) Object.assign(env, resolved.envPlan.extraEnv)
          const sensitiveEnvKeys = current
            ? resolved?.envPlan.unsetKeys ?? []
            : (profile?.envs ?? []).filter((e) => e.sensitive && e.key).map((e) => e.key)
          // In NO_COLOR, Claude's suggested next prompt is indistinguishable from a native draft.
          // RingCode owns the draft in these sessions; keep suggestions off without editing CLI settings.
          if (family === 'claude') {
            env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION = 'false'
            // RingCode owns mouse selection and scrollback; Claude must emit the full history.
            env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN = '1'
          }
          const ptyId = await ptyClient.spawn(terminal.id, {
            exe,
            args,
            cwd,
            env,
            cols,
            rows,
            credentialRef: resolved?.credentialRef ?? profile?.credentialRef,
            sensitiveEnvKeys,
            unsetEnvKeys: resolved?.envPlan.unsetKeys,
            credentialEnv: resolved?.envPlan.injectKey,
            requireCredential: resolved?.requireCredential,
            extraEnv: resolved?.envPlan.extraEnv,
            cloneId: resolved?.requireCredential ? terminal.tool : undefined,
            codexOverlay: resolved?.overlay,
            claudeSettings: resolved?.claudeSettings,
          })
          if (!ptyId || disposed) return
          commitLaunchEntry()
        } else {
          exe = app.settings.shellExe || ''
          const ptyId = await ptyClient.spawn(terminal.id, { exe, args, cwd, env, cols, rows })
          if (!ptyId || disposed) return
        }
      } catch (err) {
        fail(err)
        return
      }
      if (disposed) return
      if (terminal.sessionId && action === 'new' && terminal.initialPrompt?.trim()) {
        useAppStore.getState().markSessionConversationStarted(terminal.sessionId)
      }
      if (terminal.sessionId) useAppStore.getState().setSessionStatus(terminal.sessionId, 'running')

      const nativeLink = createNativeSessionLookup(async () => {
        if (!terminal.sessionId || !terminal.tool || action === 'resume' || disposed) return false
        const current = useAppStore.getState().sessions.find((s) => s.id === terminal.sessionId)
        if (!current || current.autoTitled === false) return true
        try {
          const found = await window.ringcode?.historyFindRecent?.({
            tool: historyRootTool(terminal.tool, useAppStore.getState().settings.customAgents ?? []),
            projectPath: cwd,
            startedAt: current.createdAt,
            excludeSessionId: action === 'fork' ? sourceNativeSessionId : undefined,
            sessionId: current.nativeSessionId,
          })
          if (found?.sessionId && !disposed) {
            useAppStore.getState().linkNativeSession(current.id, found.sessionId, found.title)
            return true
          }
        } catch {
          /* 原生历史可能尚未落盘，后续输入/输出会再次尝试 */
        }
        return false
      })
      const scheduleNativeLink = (delay = 1_200) => {
        if (action === 'resume' || !terminal.sessionId) return
        nativeLink.schedule(delay)
      }
      scheduleNativeLink()

      // 输入 -> pty
      const d1 = term.onData((d) => {
        if (modeRef.current.enhanced && !generatedInput.current) {
          if (!modeRef.current.nativeMode && !modeRef.current.menuMode && !/^\x1b\[\??[\d;]*[cRn]$/.test(d)) return
          if (modeRef.current.nativeMode && !/^\x1b\[\??[\d;]*[cRn]$/.test(d)) nativeInputDirty.current = true
          if (modeRef.current.nativeMode && d === '\r' && terminal.sessionId && stagedImageIds.current.length) {
            useAppStore.getState().retainSessionImages(terminal.sessionId, stagedImageIds.current)
            stagedImageIds.current = []
          }
        }
        ptyClient.write(terminal.id, d)
        if (!modeRef.current.menuMode && terminal.sessionId && conversationInput.push(d)) {
          useAppStore.getState().markSessionConversationStarted(terminal.sessionId)
        }
        scheduleNativeLink(1_500)
      })
      // pty -> 输出
      const transcript = createTranscriptBuffer((sessionId, chunk) => {
        const st = useAppStore.getState()
        if (st.settings.saveTranscript) st.appendTranscript(sessionId, chunk)
      }, 400)
      const d2 = ptyClient.onData((tabId, data) => {
        if (tabId !== terminal.id) return
        sawOutput = true
        term.write(data)
        if (terminal.sessionId) transcript.push(terminal.sessionId, data)
        scheduleNativeLink(1_500)
        if (terminal.initialPrompt && promptViaStdin && !initialPromptSent) {
          initialPromptSent = true
          initialPromptTimer = setTimeout(() => {
            if (!disposed) ptyClient.write(terminal.id, `${terminal.initialPrompt}\r`)
          }, 350)
        }
      })
      // 退出
      const d3 = ptyClient.onExit((tabId, code) => {
        if (tabId !== terminal.id) return
        setProcessReady(false)
        term.write(`\r\n\x1b[38;5;245m[进程已退出，代码 ${code}]\x1b[0m\r\n`)
        void nativeLink.run()
        if (terminal.sessionId) {
          const st = useAppStore.getState()
          st.setSessionStatus(terminal.sessionId, code === 0 ? 'ended' : 'failed')
          if (code !== 0 && action === 'resume') {
            if (!sawOutput) {
              const reverted = revertLaunchAttemptIfLatest(terminal.sessionId, terminal.launchAttemptId)
              if (reverted) st.setLastCloneId(terminal.sessionId, reverted.previous)
            }
            st.showToast('原会话未恢复，请检查原生会话是否仍可用', 'error')
          } else if (code !== 0 && action === 'fork') st.showToast('分支创建失败，可改用基于正文新建', 'error')
        }
        // TRM-008：AI 会话结束/失败，且窗口未聚焦或异常退出时发系统通知
        if (terminal.kind === 'ai' && (!document.hasFocus() || code !== 0)) {
          window.ringcode?.showNotification(
            code === 0 ? 'AI 会话已结束' : 'AI 会话异常退出',
            `${terminal.tool ?? '会话'} 进程已退出，退出码 ${code}`,
          )
        }
      })
      cleanup = () => {
        nativeLink.dispose()
        if (initialPromptTimer) clearTimeout(initialPromptTimer)
        transcript.flushAll()
        d1.dispose()
        d2()
        d3()
      }
    }

    const doFit = () => {
      if (!containerRef.current || containerRef.current.clientWidth < 8) return
      try {
        fit.fit()
        syncTerminalViewport(term)
        if (ptyClient.isReal) ptyClient.resize(terminal.id, term.cols, term.rows)
      } catch {
        /* 容器尚未量好时 FitAddon 会抛错 */
      }
    }

    const start = async () => {
      try {
        for (let i = 0; i < 10 && !disposed; i++) {
          doFit()
          const el = containerRef.current
          if (el && el.clientWidth >= 8 && el.clientHeight >= 8) break
          await new Promise<void>((r) => requestAnimationFrame(() => r()))
        }
        if (disposed) return
        if (ptyClient.isReal && !terminal.orphaned) {
          await spawnReal()
          if (!disposed) setProcessReady(ptyClient.hasProcess(terminal.id))
        } else if (!ptyClient.isReal) {
          const pty = new MockPty(
            { out: (s) => term.write(s) },
            terminal.kind === 'ai' ? { mode: 'ai', tool: terminal.tool as MockTool } : { mode: 'shell' },
          )
          const d1 = term.onData((d) => pty.input(d))
          cleanup = () => {
            d1.dispose()
            pty.dispose()
          }
        }
        if (disposed) return
        doFit()
        if (modeRef.current.focused !== false) {
          if (modeRef.current.enhanced && !modeRef.current.nativeMode && !modeRef.current.menuMode) inputRef.current?.focus()
          else term.focus()
        }
      } catch (err) {
        fail(err)
      }
    }
    const raf = requestAnimationFrame(() => {
      void start()
    })

    const ro = new ResizeObserver(() => doFit())
    ro.observe(containerRef.current!)

    return () => {
      disposed = true
      unregisterTarget()
      pasteTargetRef.current = null
      cancelAnimationFrame(raf)
      ro.disconnect()
      mouseModeSet?.dispose()
      mouseModeReset?.dispose()
      parsed.dispose()
      rendered.dispose()
      scrolled.dispose()
      cancelAnimationFrame(presentationFrame)
      cancelAnimationFrame(viewportFrame)
      refreshPresentation.current = () => {}
      cleanup?.()
      ptyClient.dispose(terminal.id)
      term.dispose()
      termRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminal.id, terminal.orphaned])

  // 主题变化时刷新配色
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = termTheme()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeKey])

  useEffect(() => {
    refreshPresentation.current()
    if (previousMenu.current && !menuMode && !nativeMode && active && focused !== false) inputRef.current?.focus()
    previousMenu.current = menuMode
  }, [nativeMode, menuMode, active, focused, themeKey])

  // 激活时重新 fit + 聚焦
  useEffect(() => {
    if (!active) return
    const syncOnRestore = () => {
      if (document.hidden) return
      requestAnimationFrame(() => {
        const term = termRef.current
        if (term && containerRef.current?.clientWidth) syncTerminalViewport(term)
      })
    }
    window.addEventListener('focus', syncOnRestore)
    document.addEventListener('visibilitychange', syncOnRestore)
    let raf = 0
    if (fitRef.current && containerRef.current?.clientWidth) {
      raf = requestAnimationFrame(() => {
        try {
          const term = termRef.current
          if (!term || !fitRef.current) return
          fitRef.current.fit()
          syncTerminalViewport(term)
          if (ptyClient.isReal) {
            ptyClient.resize(terminal.id, term.cols, term.rows)
          }
          if (modeRef.current.focused !== false) {
            if (modeRef.current.enhanced && !modeRef.current.nativeMode && !modeRef.current.menuMode) inputRef.current?.focus()
            else term.focus()
          }
        } catch {
          /* ignore */
        }
      })
    }
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('focus', syncOnRestore)
      document.removeEventListener('visibilitychange', syncOnRestore)
    }
  }, [active, focused, terminal.id])

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const files = Array.from(e.dataTransfer.files)
    const fromFiles = files
      .map((f) => (f as File & { path?: string }).path)
      .filter((p): p is string => !!p)
    const fromApp =
      e.dataTransfer.getData('application/x-ringcode-path') || e.dataTransfer.getData('text/plain')
    const paths = fromFiles.length
      ? fromFiles
      : fromApp
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    if (!paths.length) return
    if (!ptyClient.isReal || terminal.orphaned) return
    pasteTargetRef.current?.paste(paths.map(quoteForShell).join(' ') + ' ')
  }
  const onContextMenu = (e: React.MouseEvent) => {
    const pasteTarget = pasteTargetRef.current
    if (!pasteTarget || terminal.orphaned) return
    void handleTerminalContextMenu(
      e,
      pasteTarget,
      () => {
        if (window.ringcode?.readClipboardText) return window.ringcode.readClipboardText()
        return navigator.clipboard.readText()
      },
      (selection) => window.ringcode?.showTerminalContextMenu(selection),
    ).catch(() => useAppStore.getState().showToast('无法读取剪贴板', 'error'))
  }
  const onRightMouseEventCapture = (e: React.MouseEvent) => {
    suppressTerminalRightMouseEvent(e)
  }
  const onPasteCapture = (e: React.ClipboardEvent) => {
    const pasteTarget = pasteTargetRef.current
    if (!pasteTarget || terminal.orphaned) return
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    e.preventDefault()
    e.stopPropagation()
    pasteTarget.paste(text)
  }

  return (
    <div
      style={{ display: active ? 'flex' : 'none', flexDirection: 'column', width: '100%', height: '100%', position: 'relative', minHeight: 0 }}
    >
      <div className={`terminal-output-frame${outputOnly ? ' terminal-output-only' : ''}`}>
      <div ref={containerRef} className="terminal-output" style={{ width: '100%', height: '100%', minHeight: 0 }}
        onDragOverCapture={onDragOver} onDropCapture={onDrop}
        onMouseDownCapture={onRightMouseEventCapture} onMouseUpCapture={(e) => {
          onRightMouseEventCapture(e)
          if (e.button === 0 && outputOnly && !termRef.current?.getSelection()) inputRef.current?.focus()
        }}
        onContextMenuCapture={onContextMenu} onPasteCapture={onPasteCapture} />
      {outputOnly && inputMasks.map((mask, i) => <div key={i} className="terminal-input-mask" aria-hidden="true" style={mask} />)}
      </div>
      {enhanced && <TerminalComposer id={terminal.id} sessionId={terminal.sessionId} inputRef={inputRef} nativeMode={nativeMode} menuMode={menuMode}
        disabled={!processReady || !!terminal.orphaned} send={send} latest={() => termRef.current?.scrollToBottom()}
        interrupt={() => {
          if (!ptyClient.hasProcess(terminal.id)) return
          generatedInput.current = true
          try { termRef.current?.input('\x1b') } finally { generatedInput.current = false }
        }}
        toggleNative={() => {
          if (menuMode && !nativeMode) {
            termRef.current?.scrollToBottom()
            termRef.current?.focus()
            return
          }
          if (nativeMode) {
            if (termRef.current && !promptCanReceive(termRef.current, family!)) {
              useAppStore.getState().showToast('请先退出菜单并清空原生输入，再返回底部输入框', 'info')
              return
            }
            nativeInputDirty.current = false
            stagedImageIds.current = []
            setNativeMode(false)
            requestAnimationFrame(() => inputRef.current?.focus())
          } else {
            setNativeMode(true)
            termRef.current?.focus()
          }
        }} />}
      {terminal.orphaned ? (
        <div
          className="empty-state"
          style={{ position: 'absolute', inset: 0, background: 'var(--term-bg, var(--surface))' }}
        >
          <div>终端进程未恢复</div>
          <div style={{ fontSize: 11 }}>应用重启后不恢复已终止进程</div>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => reviveTerminal(terminal.id)}>
            重新启动
          </button>
        </div>
      ) : null}
    </div>
  )
}
