import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { sqliteStorage } from '@/lib/sqliteStorage'
import { rehydratePersistedSlice, shouldDiscardEmptySession } from '@/lib/sessionLifecycle'
import { migrateProfilesForBuiltinAgents, seedProfilesFromAgents, terminalTitleFor } from '@/lib/agents'
import { applyAutoSessionTitle } from '@/lib/sessionTitle'
import { historyAliasKey } from '@/lib/sessionHistory'
import { setVisibleHistoryExpansion } from '@/lib/historyGrouping'
import { withoutRecentFile } from '@/lib/recentFiles'
import type {
  AgentDef,
  AppSettings,
  LayoutState,
  PermissionChoice,
  RecentFile,
  SavedLayout,
  Session,
  SessionStatus,
  SettingsTab,
  Skill,
  TerminalTab,
  ThemeMode,
  ToastMsg,
  ToolProfile,
  ToolType,
  Workspace,
} from '@/types'

export const uid = (): string =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

const now = () => Date.now()

/** 默认全局配置方案（由内置 Agent 注册表生成） */
function seedProfiles(): ToolProfile[] {
  return seedProfilesFromAgents()
}

interface AppState {
  // 数据
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  sessions: Session[]
  /** tool:nativeSessionId -> RingCode 本地显示别名 */
  historyAliases: Record<string, string>
  /** 本地/磁盘历史分别记住目录展开状态 */
  historyExpandedGroups: {
    local: Record<string, boolean>
    disk: Record<string, boolean>
  }
  activeSessionId: string | null
  profiles: ToolProfile[]
  terminals: TerminalTab[]
  activeTerminalId: string | null
  layout: LayoutState
  savedLayouts: SavedLayout[]
  skills: Skill[]
  settings: AppSettings
  recentFiles: RecentFile[]
  splitTerminalId: string | null

  // 临时 UI
  commandPaletteOpen: boolean
  settingsOpen: boolean
  settingsTab: SettingsTab
  settingsProfileId: string | null
  wizardOpen: boolean
  centerTopTab: 'fm' | 'editor' | 'preview' | 'diff' | 'skills' | 'search'
  historyDiskMode: boolean
  /** 自定义 prompt 对话框（Electron 下 window.prompt 失效，用此替代） */
  promptDialog: { message: string; defaultValue: string; resolve: (v: string | null) => void } | null
  /** 自定义 confirm 对话框（Electron 下 window.confirm 不可靠，用此替代） */
  confirmDialog: { message: string; resolve: (v: boolean) => void } | null
  toasts: ToastMsg[]

  // 工作区
  addWorkspace: (path: string, name: string, mock?: boolean) => Workspace
  removeWorkspace: (id: string) => void
  switchWorkspace: (id: string) => void
  renameWorkspace: (id: string, name: string) => void
  toggleFavoriteWorkspace: (id: string) => void

  // 配置方案
  getProfile: (id: string) => ToolProfile | undefined
  getProfileForTool: (tool: ToolType, workspaceId?: string) => ToolProfile | undefined
  upsertProfile: (p: ToolProfile) => void
  deleteProfile: (id: string) => void
  setCustomAgents: (agents: AgentDef[]) => void

  // 会话
  createSession: (
    tool: ToolType,
    profileId: string,
    cwd: string,
    opts?: { permission?: PermissionChoice; sourceSessionId?: string; sourceTitle?: string; title?: string },
  ) => Session
  setSessionStatus: (id: string, status: SessionStatus) => void
  linkNativeSession: (id: string, nativeSessionId: string, nativeTitle?: string) => void
  markSessionConversationStarted: (id: string) => void
  appendTranscript: (id: string, chunk: string) => void
  renameSession: (id: string, title: string) => void
  renameHistory: (tool: string, nativeSessionId: string, title: string) => void
  toggleFavoriteSession: (id: string) => void
  deleteSession: (id: string) => void
  setActiveSession: (id: string | null) => void

  // 终端
  newTerminal: (
    kind: TerminalTab['kind'],
    opts?: {
      tool?: ToolType
      sessionId?: string
      title?: string
      action?: 'new' | 'resume' | 'fork'
      sourceNativeSessionId?: string
      initialPrompt?: string
      resume?: boolean
      autoMode?: boolean
      permission?: PermissionChoice
    },
  ) => string
  closeTerminal: (id: string) => void
  setActiveTerminal: (id: string) => void
  renameTerminal: (id: string, title: string) => void
  reviveTerminal: (id: string) => void
  setSplitTerminal: (id: string | null) => void

  // 布局
  setLayout: (patch: Partial<LayoutState>) => void
  togglePanel: (which: 'left' | 'right' | 'bottom') => void
  saveLayout: (name: string) => void
  applySavedLayout: (id: string) => void
  deleteSavedLayout: (id: string) => void

  // Skill 库（SKL-001/002/003）
  addSkill: (skill: Skill) => void
  deleteSkill: (id: string) => void

  // 设置
  setTheme: (t: ThemeMode) => void
  setDefaultTool: (t: ToolType) => void
  completeFirstRun: () => void
  resolveTheme: () => 'dark' | 'light'
  setKeymap: (keymap: Record<string, string>) => void
  setShellExe: (exe: string) => void
  touchRecentFile: (file: Omit<RecentFile, 'at'>) => void
  removeRecentFile: (workspaceId: string, segments: string[]) => void
  patchSettings: (patch: Partial<AppSettings>) => void

  // UI
  openCommandPalette: () => void
  closeCommandPalette: () => void
  openSettings: (tab?: SettingsTab, profileId?: string) => void
  setSettingsOpen: (v: boolean) => void
  setWizardOpen: (v: boolean) => void
  setHistoryDiskMode: (v: boolean) => void
  setHistoryGroupExpanded: (mode: 'local' | 'disk', key: string, expanded: boolean) => void
  setVisibleHistoryGroupsExpanded: (mode: 'local' | 'disk', keys: string[], expanded: boolean) => void
  showPrompt: (message: string, defaultValue?: string) => Promise<string | null>
  resolvePrompt: (value: string | null) => void
  showConfirm: (message: string) => Promise<boolean>
  resolveConfirm: (value: boolean) => void
  setCenterTopTab: (tab: 'fm' | 'editor' | 'preview' | 'diff' | 'skills' | 'search') => void
  showToast: (text: string, level?: ToastMsg['level']) => void
  dismissToast: (id: string) => void
}

const defaultLayout: LayoutState = {
  leftWidth: 250,
  rightWidth: 300,
  centerSplit: 0.4,
  leftHidden: false,
  rightHidden: false,
  bottomHidden: false,
}

const defaultSettings: AppSettings = {
  theme: 'dark',
  defaultTool: 'claude',
  saveTranscript: true,
  transcriptRetentionDays: 0, // 0 = 长期保留
  firstRunDone: false,
  customAgents: [],
  keymap: {},
  shellExe: 'powershell.exe',
  launchPermissionByAgent: { claude: 'auto', opencode: 'default', antigravity: 'default', hermes: 'default' },
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      workspaces: [],
      activeWorkspaceId: null,
      sessions: [],
      historyAliases: {},
      historyExpandedGroups: { local: {}, disk: {} },
      activeSessionId: null,
      profiles: seedProfiles(),
      terminals: [],
      activeTerminalId: null,
      layout: defaultLayout,
      savedLayouts: [],
      skills: [],
      settings: defaultSettings,
      recentFiles: [],
      splitTerminalId: null,

      commandPaletteOpen: false,
      settingsOpen: false,
      settingsTab: 'general',
      settingsProfileId: null,
      wizardOpen: false,
      centerTopTab: 'fm',
      historyDiskMode: false,
      promptDialog: null,
      confirmDialog: null,
      toasts: [],

      addWorkspace: (path, name, mock) => {
        const ws: Workspace = { id: uid(), path, name, lastOpenedAt: now(), mock }
        set((s) => ({ workspaces: [...s.workspaces, ws], activeWorkspaceId: ws.id }))
        void window.ringcode?.setWorkspaceRoots?.(get().workspaces.map((w) => w.path).filter(Boolean))
        return ws
      },
      removeWorkspace: (id) => {
        set((s) => ({
          workspaces: s.workspaces.filter((w) => w.id !== id),
          activeWorkspaceId: s.activeWorkspaceId === id ? null : s.activeWorkspaceId,
        }))
        void window.ringcode?.setWorkspaceRoots?.(get().workspaces.map((w) => w.path).filter(Boolean))
      },
      switchWorkspace: (id) =>
        set((s) => ({
          activeWorkspaceId: id,
          workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, lastOpenedAt: now() } : w)),
        })),
      renameWorkspace: (id, name) =>
        set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name } : w)) })),
      toggleFavoriteWorkspace: (id) =>
        set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, favorite: !w.favorite } : w)) })),

      getProfile: (id) => get().profiles.find((p) => p.id === id),
      getProfileForTool: (tool, workspaceId) => {
        const ps = get().profiles
        return (
          ps.find((p) => p.tool === tool && p.scope === 'workspace' && p.workspaceId === workspaceId) ||
          ps.find((p) => p.tool === tool && p.scope === 'global') ||
          ps.find((p) => p.tool === tool)
        )
      },
      upsertProfile: (p) =>
        set((s) => {
          const exists = s.profiles.some((x) => x.id === p.id)
          return { profiles: exists ? s.profiles.map((x) => (x.id === p.id ? p : x)) : [...s.profiles, p] }
        }),
      deleteProfile: (id) => set((s) => ({ profiles: s.profiles.filter((p) => p.id !== id) })),
      setCustomAgents: (agents) =>
        set((s) => ({ settings: { ...s.settings, customAgents: agents } })),

      createSession: (tool, profileId, cwd, opts) => {
        const profile = get().getProfile(profileId)
        const title = opts?.title || (profile?.name ? `${profile.name} 会话` : '新建会话')
        const session: Session = {
          id: uid(),
          title,
          tool,
          workspaceId: get().activeWorkspaceId || '',
          profileId,
          cwd,
          status: 'running',
          createdAt: now(),
          lastActiveAt: now(),
          transcript: '',
          resumable: false,
          launchPermission: opts?.permission,
          sourceSessionId: opts?.sourceSessionId,
          sourceTitle: opts?.sourceTitle,
          autoTitled: !opts?.title,
          conversationStarted: false,
        }
        set((s) => ({ sessions: [session, ...s.sessions], activeSessionId: session.id }))
        return session
      },
      setSessionStatus: (id, status) =>
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === id
              ? {
                  ...x,
                  status,
                  endedAt: status === 'running' ? undefined : status === 'ended' || status === 'failed' ? now() : x.endedAt,
                  lastActiveAt: now(),
                }
              : x,
          ),
        })),
      linkNativeSession: (id, nativeSessionId, nativeTitle) =>
        set((s) => ({
          sessions: s.sessions.map((x) => {
            if (x.id !== id) return x
            const next = applyAutoSessionTitle(x, nativeTitle)
            return {
              ...x,
              nativeSessionId,
              resumable: true,
              title: next?.title ?? x.title,
              nativeTitled: next?.nativeTitled ?? x.nativeTitled,
              lastActiveAt: now(),
            }
          }),
        })),
      markSessionConversationStarted: (id) =>
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === id && !x.conversationStarted ? { ...x, conversationStarted: true, lastActiveAt: now() } : x,
          ),
        })),
      appendTranscript: (id, chunk) => {
        const cur = get().sessions.find((x) => x.id === id)
        const next = (cur?.transcript ?? '') + chunk
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === id ? { ...x, transcript: next.slice(-200_000), lastActiveAt: now() } : x,
          ),
        }))
      },
      renameSession: (id, title) =>
        set((s) => {
          const target = s.sessions.find((x) => x.id === id)
          const aliases = { ...s.historyAliases }
          if (target?.nativeSessionId) aliases[historyAliasKey(target.tool, target.nativeSessionId)] = title
          return {
            sessions: s.sessions.map((x) => (x.id === id ? { ...x, title, autoTitled: false } : x)),
            historyAliases: aliases,
          }
        }),
      renameHistory: (tool, nativeSessionId, title) =>
        set((s) => ({
          historyAliases: { ...s.historyAliases, [historyAliasKey(tool, nativeSessionId)]: title },
          sessions: s.sessions.map((x) =>
            x.tool === tool && x.nativeSessionId === nativeSessionId ? { ...x, title, autoTitled: false } : x,
          ),
        })),
      toggleFavoriteSession: (id) =>
        set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, favorite: !x.favorite } : x)) })),
      deleteSession: (id) =>
        set((s) => ({
          sessions: s.sessions.filter((x) => x.id !== id),
          activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
        })),
      setActiveSession: (id) => set({ activeSessionId: id }),

      newTerminal: (kind, opts) => {
        const extra = get().settings.customAgents ?? []
        if (kind === 'ai' && opts?.tool) {
          const profile = get().getProfileForTool(opts.tool, get().activeWorkspaceId ?? undefined)
          if (profile?.terminalStrategy === 'reuse-idle') {
            const idle = get().terminals.find((t) => t.kind === 'ai' && t.tool === opts.tool && t.orphaned)
            if (idle) {
              const permission: PermissionChoice | undefined =
                opts.permission ?? (opts.autoMode ? 'auto' : undefined)
              set((s) => ({
                terminals: s.terminals.map((t) =>
                  t.id === idle.id
                    ? {
                        ...t,
                        sessionId: opts.sessionId,
                        action: opts.action ?? (opts.resume ? 'resume' : 'new'),
                        sourceNativeSessionId: opts.sourceNativeSessionId,
                        initialPrompt: opts.initialPrompt,
                        resume: opts.action === 'resume' || opts.resume,
                        permission,
                        autoMode: permission === 'auto',
                        orphaned: false,
                      }
                    : t,
                ),
                activeTerminalId: idle.id,
              }))
              return idle.id
            }
          }
        }
        const id = uid()
        const existing = get().terminals.filter((t) => t.kind === 'ai' && t.tool === opts?.tool).length
        const permission: PermissionChoice | undefined =
          opts?.permission ?? (opts?.autoMode ? 'auto' : undefined)
        const title =
          opts?.title ||
          (kind === 'ai' && opts?.tool ? terminalTitleFor(opts.tool, existing + 1, extra) : 'powershell')
        const tab: TerminalTab = {
          id,
          title,
          kind,
          tool: opts?.tool,
          sessionId: opts?.sessionId,
          action: opts?.action ?? (opts?.resume ? 'resume' : 'new'),
          sourceNativeSessionId: opts?.sourceNativeSessionId,
          initialPrompt: opts?.initialPrompt,
          resume: opts?.action === 'resume' || opts?.resume,
          permission,
          autoMode: permission === 'auto',
          orphaned: false,
          createdAt: now(),
        }
        set((s) => ({ terminals: [...s.terminals, tab], activeTerminalId: id }))
        return id
      },
      closeTerminal: (id) =>
        set((s) => {
          const idx = s.terminals.findIndex((t) => t.id === id)
          const terminal = s.terminals[idx]
          const next = s.terminals.filter((t) => t.id !== id)
          const session = terminal?.sessionId ? s.sessions.find((item) => item.id === terminal.sessionId) : undefined
          const discardSession = !!session && shouldDiscardEmptySession(session, terminal)
          let active = s.activeTerminalId
          if (active === id) active = next[idx] ? next[idx].id : next[idx - 1]?.id ?? next[0]?.id ?? null
          const split = s.splitTerminalId === id ? null : s.splitTerminalId
          return {
            terminals: next,
            sessions: discardSession ? s.sessions.filter((item) => item.id !== session.id) : s.sessions,
            activeSessionId: discardSession && s.activeSessionId === session.id ? null : s.activeSessionId,
            activeTerminalId: active,
            splitTerminalId: split,
          }
        }),
      setActiveTerminal: (id) => set({ activeTerminalId: id }),
      renameTerminal: (id, title) =>
        set((s) => ({ terminals: s.terminals.map((t) => (t.id === id ? { ...t, title } : t)) })),
      reviveTerminal: (id) =>
        set((s) => ({ terminals: s.terminals.map((t) => (t.id === id ? { ...t, orphaned: false } : t)) })),
      setSplitTerminal: (id) => set({ splitTerminalId: id }),

      setLayout: (patch) => set((s) => ({ layout: { ...s.layout, ...patch } })),
      togglePanel: (which) =>
        set((s) => ({
          layout: {
            ...s.layout,
            leftHidden: which === 'left' ? !s.layout.leftHidden : s.layout.leftHidden,
            rightHidden: which === 'right' ? !s.layout.rightHidden : s.layout.rightHidden,
            bottomHidden: which === 'bottom' ? !s.layout.bottomHidden : s.layout.bottomHidden,
          },
        })),
      saveLayout: (name) =>
        set((s) => ({
          savedLayouts: [...s.savedLayouts, { id: uid(), name, layout: { ...s.layout } }],
        })),
      applySavedLayout: (id) => {
        const found = get().savedLayouts.find((l) => l.id === id)
        if (found) set({ layout: { ...found.layout } })
      },
      deleteSavedLayout: (id) =>
        set((s) => ({ savedLayouts: s.savedLayouts.filter((l) => l.id !== id) })),

      addSkill: (skill) => set((s) => ({ skills: [skill, ...s.skills] })),
      deleteSkill: (id) => set((s) => ({ skills: s.skills.filter((k) => k.id !== id) })),

      setTheme: (t) => set((s) => ({ settings: { ...s.settings, theme: t } })),
      setDefaultTool: (t) => set((s) => ({ settings: { ...s.settings, defaultTool: t } })),
      completeFirstRun: () => set((s) => ({ settings: { ...s.settings, firstRunDone: true }, wizardOpen: false })),
      setKeymap: (keymap) => set((s) => ({ settings: { ...s.settings, keymap } })),
      setShellExe: (exe) => set((s) => ({ settings: { ...s.settings, shellExe: exe } })),
      patchSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      touchRecentFile: (file) =>
        set((s) => {
          const key = `${file.workspaceId}:${file.segments.join('/')}`
          const rest = s.recentFiles.filter((f) => `${f.workspaceId}:${f.segments.join('/')}` !== key)
          return { recentFiles: [{ ...file, at: now() }, ...rest].slice(0, 16) }
        }),
      removeRecentFile: (workspaceId, segments) =>
        set((s) => ({ recentFiles: withoutRecentFile(s.recentFiles, workspaceId, segments) })),
      resolveTheme: () => {
        const t = get().settings.theme
        if (t !== 'system') return t
        return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
      },

      openCommandPalette: () => set({ commandPaletteOpen: true }),
      closeCommandPalette: () => set({ commandPaletteOpen: false }),
      openSettings: (tab = 'general', profileId) =>
        set({ settingsOpen: true, settingsTab: tab, settingsProfileId: profileId ?? null }),
      setSettingsOpen: (v) => set({ settingsOpen: v, ...(!v ? { settingsProfileId: null } : {}) }),
      setWizardOpen: (v) => set({ wizardOpen: v }),
      setHistoryDiskMode: (v) => set({ historyDiskMode: v }),
      setHistoryGroupExpanded: (mode, key, expanded) =>
        set((s) => ({
          historyExpandedGroups: {
            ...s.historyExpandedGroups,
            [mode]: { ...s.historyExpandedGroups[mode], [key]: expanded },
          },
        })),
      setVisibleHistoryGroupsExpanded: (mode, keys, expanded) =>
        set((s) => ({
          historyExpandedGroups: {
            ...s.historyExpandedGroups,
            [mode]: setVisibleHistoryExpansion(s.historyExpandedGroups[mode], keys, expanded),
          },
        })),
      showPrompt: (message, defaultValue = '') =>
        new Promise<string | null>((resolve) => {
          set({ promptDialog: { message, defaultValue, resolve } })
        }),
      resolvePrompt: (value) => {
        const d = get().promptDialog
        if (d) d.resolve(value)
        set({ promptDialog: null })
      },
      showConfirm: (message) =>
        new Promise<boolean>((resolve) => {
          set({ confirmDialog: { message, resolve } })
        }),
      resolveConfirm: (value) => {
        const d = get().confirmDialog
        if (d) d.resolve(value)
        set({ confirmDialog: null })
      },
      setCenterTopTab: (tab) => set({ centerTopTab: tab }),
      showToast: (text, level = 'info') => {
        const id = uid()
        set((s) => ({ toasts: [...s.toasts, { id, text, level }] }))
        setTimeout(() => get().dismissToast(id), 3200)
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    {
      name: 'ringcode-store',
      version: 7,
      storage: createJSONStorage(() => sqliteStorage),
      migrate: (persisted, fromVersion) => {
        if (fromVersion < 2) return {}
        const p = (persisted ?? {}) as Record<string, unknown>
        const profiles = migrateProfilesForBuiltinAgents(Array.isArray(p.profiles) ? p.profiles as ToolProfile[] : [])
        const savedSettings = (p.settings as AppSettings | undefined) ?? defaultSettings
        const launchPermissionByAgent = { ...(savedSettings.launchPermissionByAgent ?? {}) }
        if (!launchPermissionByAgent.antigravity && launchPermissionByAgent.gemini) {
          launchPermissionByAgent.antigravity = launchPermissionByAgent.gemini
        }
        delete launchPermissionByAgent.gemini
        const keymap = { ...(savedSettings.keymap ?? {}) }
        if (!keymap['ai.antigravity'] && keymap['ai.gemini']) keymap['ai.antigravity'] = keymap['ai.gemini']
        delete keymap['ai.gemini']
        const settings: AppSettings = {
          ...defaultSettings,
          ...savedSettings,
          defaultTool: savedSettings.defaultTool === 'gemini' ? 'antigravity' : savedSettings.defaultTool,
          keymap,
          launchPermissionByAgent,
        }
        const sessions = Array.isArray(p.sessions)
          ? (p.sessions as Session[]).map((s) => ({
              ...s,
              tool: s.tool === 'gemini' ? 'antigravity' : s.tool,
              profileId: s.profileId === 'pf-gemini-default' ? 'pf-antigravity-default' : s.profileId,
              resumable: !!s.nativeSessionId || !!s.resumable,
            }))
          : []
        const terminals = Array.isArray(p.terminals)
          ? (p.terminals as TerminalTab[]).map((t) => ({
              ...t,
              tool: t.tool === 'gemini' ? 'antigravity' : t.tool,
              action: t.action ?? (t.resume ? 'resume' : 'new'),
            }))
          : []
        const historyAliases =
          p.historyAliases && typeof p.historyAliases === 'object'
            ? (p.historyAliases as Record<string, string>)
            : {}
        const rawExpanded = p.historyExpandedGroups as
          | { local?: Record<string, boolean>; disk?: Record<string, boolean> }
          | undefined
        const historyExpandedGroups = {
          local: rawExpanded?.local && typeof rawExpanded.local === 'object' ? rawExpanded.local : {},
          disk: rawExpanded?.disk && typeof rawExpanded.disk === 'object' ? rawExpanded.disk : {},
        }
        return { ...p, profiles, settings, sessions, terminals, historyAliases, historyExpandedGroups }
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>
        const restored = rehydratePersistedSlice({
          terminals: p.terminals ?? current.terminals,
          sessions: p.sessions ?? current.sessions,
        })
        return {
          ...current,
          ...p,
          terminals: restored.terminals,
          sessions: restored.sessions,
          historyExpandedGroups: {
            local: p.historyExpandedGroups?.local ?? current.historyExpandedGroups.local,
            disk: p.historyExpandedGroups?.disk ?? current.historyExpandedGroups.disk,
          },
        }
      },
      partialize: (s) => ({
        workspaces: s.workspaces,
        activeWorkspaceId: s.activeWorkspaceId,
        sessions: s.sessions,
        historyAliases: s.historyAliases,
        historyExpandedGroups: s.historyExpandedGroups,
        profiles: s.profiles,
        terminals: s.terminals.map((t) => ({ ...t })), // 元数据保留，进程不恢复（TRM-006）
        layout: s.layout,
        savedLayouts: s.savedLayouts,
        skills: s.skills,
        settings: s.settings,
        recentFiles: s.recentFiles,
      }),
    },
  ),
)
