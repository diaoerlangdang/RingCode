import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useAppStore } from '@/store/useAppStore'
import { ptyClient } from '@/lib/ptyClient'
import { MockPty, type MockTool } from '@/lib/mockPty'
import { createTranscriptBuffer } from '@/lib/transcriptBuffer'
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
import { handleTerminalContextMenu, suppressTerminalRightMouseEvent } from '@/lib/terminalPaste'
import { registerTerminalTarget } from '@/lib/terminalRegistry'
import type { PermissionChoice, TerminalTab } from '@/types'

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
export function TerminalView({ terminal, active }: { terminal: TerminalTab; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const resolveTheme = useAppStore((s) => s.resolveTheme)
  const themeKey = resolveTheme()
  const reviveTerminal = useAppStore((s) => s.reviveTerminal)

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
    term.attachCustomKeyEventHandler(handleTerminalKeyEvent)
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
    const keepLocalTextSelection = terminalFamily === 'codex' || terminalFamily === 'antigravity'
    const mouseModeSet = keepLocalTextSelection
      ? term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, shouldBlockTerminalMouseMode)
      : undefined
    const mouseModeReset = keepLocalTextSelection
      ? term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, shouldBlockTerminalMouseMode)
      : undefined
    termRef.current = term
    fitRef.current = fit
    const unregisterTarget = registerTerminalTarget(terminal.id, {
      paste: (text: string) => term.paste(text),
      focus: () => term.focus(),
    })

    let cleanup: (() => void) | undefined
    let disposed = false
    let nativeLookupTimer: ReturnType<typeof setTimeout> | undefined
    let initialPromptTimer: ReturnType<typeof setTimeout> | undefined
    let initialPromptSent = false
    const conversationInput = createConversationInputTracker()

    let sawOutput = false

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

      const findAndLinkNativeSession = async () => {
        if (!terminal.sessionId || !terminal.tool || action === 'resume' || disposed) return
        const current = useAppStore.getState().sessions.find((s) => s.id === terminal.sessionId)
        if (!current || current.autoTitled === false) return
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
          }
        } catch {
          /* 原生历史可能尚未落盘，后续输入/输出会再次尝试 */
        }
      }
      const scheduleNativeLink = (delay = 1_200) => {
        if (action === 'resume' || !terminal.sessionId) return
        if (nativeLookupTimer) clearTimeout(nativeLookupTimer)
        nativeLookupTimer = setTimeout(() => void findAndLinkNativeSession(), delay)
      }
      scheduleNativeLink()

      // 输入 -> pty
      const d1 = term.onData((d) => {
        ptyClient.write(terminal.id, d)
        if (terminal.sessionId && conversationInput.push(d)) {
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
        term.write(`\r\n\x1b[38;5;245m[进程已退出，代码 ${code}]\x1b[0m\r\n`)
        void findAndLinkNativeSession()
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
        if (nativeLookupTimer) clearTimeout(nativeLookupTimer)
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
        term.focus()
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
      cancelAnimationFrame(raf)
      ro.disconnect()
      mouseModeSet?.dispose()
      mouseModeReset?.dispose()
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

  // 激活时重新 fit + 聚焦
  useEffect(() => {
    if (active && fitRef.current && containerRef.current?.clientWidth) {
      requestAnimationFrame(() => {
        try {
          fitRef.current!.fit()
          if (termRef.current && ptyClient.isReal) {
            ptyClient.resize(terminal.id, termRef.current.cols, termRef.current.rows)
          }
          termRef.current?.focus()
        } catch {
          /* ignore */
        }
      })
    }
  }, [active, terminal.id])

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
    ptyClient.write(terminal.id, paths.map(quoteForShell).join(' ') + ' ')
  }
  const onContextMenu = (e: React.MouseEvent) => {
    const term = termRef.current
    if (!term || terminal.orphaned) return
    void handleTerminalContextMenu(
      e,
      term,
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

  return (
    <div
      style={{ display: active ? 'block' : 'none', width: '100%', height: '100%', position: 'relative' }}
      onDragOverCapture={onDragOver}
      onDropCapture={onDrop}
      onMouseDownCapture={onRightMouseEventCapture}
      onMouseUpCapture={onRightMouseEventCapture}
      onContextMenuCapture={onContextMenu}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
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
