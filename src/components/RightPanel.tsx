import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { agentById, agentLabel, listAgents, supportsNativeFork } from '@/lib/agents'
import { prepareAgentLaunch } from '@/lib/agentLaunch'
import { cleanTranscript, displayTitle } from '@/lib/sessionText'
import {
  buildBranchContext,
  historyAliasKey,
  historyFallbackText,
  parseHistoryMessages,
  syncNativeHistoryTitles,
} from '@/lib/sessionHistory'
import {
  groupHistoryItems,
  historyDirectoryRelation,
  normalizeHistoryPath,
  pageHistoryItems,
  resolveHistoryExpansion,
  sortHistoryGroupsForWorkspace,
  type HistoryDirectoryRelation,
  type HistoryGroup,
} from '@/lib/historyGrouping'
import { HistoryDirectorySection } from '@/components/HistoryDirectorySection'
import { SessionHistoryModal, type HistoryDetailTarget } from '@/components/SessionHistoryModal'
import type {
  AgentDef,
  HistoryDirectoryGroup,
  HistoryMatch,
  PermissionChoice,
  Session,
  SessionStatus,
  ToolType,
} from '@/types'

const PAGE_SIZE = 30

const STATUS_LABEL: Record<SessionStatus, string> = {
  running: '运行中',
  ended: '已结束',
  interrupted: '已中断',
  failed: '失败',
}
const STATUS_DOT: Record<SessionStatus, string> = {
  running: 'run',
  ended: 'end',
  interrupted: 'broke',
  failed: 'fail',
}

type HistoryMode = 'local' | 'disk'
type HistoryRef = { kind: 'local'; sessionId: string } | { kind: 'disk'; match: HistoryMatch }
type DiskPageState = {
  items: HistoryMatch[]
  total: number
  loading: boolean
  requestKey: string
}
type ContextMenu =
  | { kind: 'session'; x: number; y: number; target: HistoryRef }
  | {
      kind: 'directory'
      x: number
      y: number
      mode: HistoryMode
      key: string
      name: string
      path: string
      available: boolean
      unknown: boolean
      expanded: boolean
    }

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d === 1) return '昨天'
  return `${d} 天前`
}

function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

function samePath(a: string, b: string): boolean {
  return normalizeHistoryPath(a) === normalizeHistoryPath(b)
}

function formatTranscript(s: Session, extra: AgentDef[]): string {
  return [
    `# ${displayTitle(s.title, s.transcript)}`,
    '',
    `- 工具：${agentLabel(s.tool, extra)}`,
    `- 工作目录：${s.cwd}`,
    `- 状态：${STATUS_LABEL[s.status]}`,
    `- 开始：${new Date(s.createdAt).toLocaleString()}`,
    s.endedAt ? `- 结束：${new Date(s.endedAt).toLocaleString()}` : '',
    s.sourceTitle ? `- 来源：${s.sourceTitle}` : '',
    '',
    '---',
    '',
    cleanTranscript(s.transcript) || '（无记录内容）',
  ].filter(Boolean).join('\n')
}

function diskExpansionGroups(
  groups: Array<HistoryDirectoryGroup & { relation: HistoryDirectoryRelation }>,
): HistoryGroup<never>[] {
  return groups.map((group) => ({
    key: group.key,
    path: group.path,
    name: group.name,
    relation: group.relation,
    totalCount: group.totalCount,
    matchedCount: group.matchedCount,
    latestAt: group.latestMtime,
    items: [],
  }))
}

export function RightPanel() {
  const sessions = useAppStore((s) => s.sessions)
  const historyAliases = useAppStore((s) => s.historyAliases)
  const historyExpandedGroups = useAppStore((s) => s.historyExpandedGroups)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const setActiveSession = useAppStore((s) => s.setActiveSession)
  const profiles = useAppStore((s) => s.profiles)
  const workspaces = useAppStore((s) => s.workspaces)
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const terminals = useAppStore((s) => s.terminals)
  const setActiveTerminal = useAppStore((s) => s.setActiveTerminal)
  const showToast = useAppStore((s) => s.showToast)
  const newTerminal = useAppStore((s) => s.newTerminal)
  const togglePanel = useAppStore((s) => s.togglePanel)
  const layout = useAppStore((s) => s.layout)
  const renameSession = useAppStore((s) => s.renameSession)
  const renameHistory = useAppStore((s) => s.renameHistory)
  const toggleFavoriteSession = useAppStore((s) => s.toggleFavoriteSession)
  const deleteSession = useAppStore((s) => s.deleteSession)
  const showPrompt = useAppStore((s) => s.showPrompt)
  const showConfirm = useAppStore((s) => s.showConfirm)
  const diskMode = useAppStore((s) => s.historyDiskMode)
  const setDiskMode = useAppStore((s) => s.setHistoryDiskMode)
  const setHistoryGroupExpanded = useAppStore((s) => s.setHistoryGroupExpanded)
  const setVisibleHistoryGroupsExpanded = useAppStore((s) => s.setVisibleHistoryGroupsExpanded)
  const addWorkspace = useAppStore((s) => s.addWorkspace)
  const switchWorkspace = useAppStore((s) => s.switchWorkspace)
  const extra = useAppStore((s) => s.settings.customAgents) ?? []
  const agents = listAgents(extra)

  const [query, setQuery] = useState('')
  const [toolFilter, setToolFilter] = useState<ToolType | 'all'>('all')
  const [diskGroupSummaries, setDiskGroupSummaries] = useState<HistoryDirectoryGroup[]>([])
  const [diskPages, setDiskPages] = useState<Record<string, DiskPageState>>({})
  const [diskLoading, setDiskLoading] = useState(false)
  const [diskGeneration, setDiskGeneration] = useState(0)
  const [localAvailability, setLocalAvailability] = useState<Record<string, boolean>>({})
  const [localLimits, setLocalLimits] = useState<Record<string, number>>({})
  const [diskLimits, setDiskLimits] = useState<Record<string, number>>({})
  const [temporaryExpanded, setTemporaryExpanded] = useState<{
    local: Record<string, boolean>
    disk: Record<string, boolean>
  }>({ local: {}, disk: {} })
  const [selectedDiskFile, setSelectedDiskFile] = useState<string | null>(null)
  const [detail, setDetail] = useState<HistoryRef | null>(null)
  const [menu, setMenu] = useState<ContextMenu | null>(null)
  const historyListRef = useRef<HTMLDivElement>(null)
  const diskGroupRequestId = useRef(0)
  const previousActiveSessionId = useRef(activeSessionId)

  const active = sessions.find((s) => s.id === activeSessionId) ?? null
  const activeProfile = active ? profiles.find((p) => p.id === active.profileId) : null
  const activeWs = active ? workspaces.find((w) => w.id === active.workspaceId) : null
  const activeWorkspacePath = workspaces.find((w) => w.id === activeWorkspaceId)?.path ?? ''
  const filtering = !!query.trim() || toolFilter !== 'all'
  const mode: HistoryMode = diskMode ? 'disk' : 'local'

  const localGroups = useMemo(
    () =>
      groupHistoryItems(sessions, {
        getId: (session) => session.id,
        getDirectory: (session) => session.cwd,
        getUpdatedAt: (session) => session.lastActiveAt,
        getTool: (session) => session.tool,
        getSearchText: (session) => `${session.title}\n${cleanTranscript(session.transcript)}`,
        activeWorkspacePath,
        query,
        tool: toolFilter,
      }),
    [sessions, activeWorkspacePath, query, toolFilter],
  )

  const allLocalGroups = useMemo(
    () =>
      groupHistoryItems(sessions, {
        getId: (session) => session.id,
        getDirectory: (session) => session.cwd,
        getUpdatedAt: (session) => session.lastActiveAt,
        getTool: (session) => session.tool,
        getSearchText: (session) => `${session.title}\n${cleanTranscript(session.transcript)}`,
        activeWorkspacePath,
      }),
    [sessions, activeWorkspacePath],
  )

  const diskGroups = useMemo(
    () =>
      sortHistoryGroupsForWorkspace(
        diskGroupSummaries,
        activeWorkspacePath,
        (group) => group.path,
        (group) => group.latestMtime,
        (group) => group.unknown,
      ).map((group) => ({
        ...group,
        relation: group.unknown
          ? ('unknown' as const)
          : historyDirectoryRelation(group.key, activeWorkspacePath),
      })),
    [diskGroupSummaries, activeWorkspacePath],
  )

  const localExpansion = useMemo(
    () => resolveHistoryExpansion(localGroups, historyExpandedGroups.local, activeWorkspacePath),
    [localGroups, historyExpandedGroups.local, activeWorkspacePath],
  )
  const diskExpansion = useMemo(
    () =>
      resolveHistoryExpansion(
        diskExpansionGroups(diskGroups),
        historyExpandedGroups.disk,
        activeWorkspacePath,
      ),
    [diskGroups, historyExpandedGroups.disk, activeWorkspacePath],
  )

  const isGroupExpanded = useCallback(
    (targetMode: HistoryMode, key: string): boolean => {
      if (filtering) {
        const temporary = temporaryExpanded[targetMode]
        return Object.prototype.hasOwnProperty.call(temporary, key) ? temporary[key] : true
      }
      return targetMode === 'local' ? !!localExpansion[key] : !!diskExpansion[key]
    },
    [filtering, temporaryExpanded, localExpansion, diskExpansion],
  )

  const toggleGroup = useCallback(
    (targetMode: HistoryMode, key: string) => {
      const next = !isGroupExpanded(targetMode, key)
      if (filtering) {
        setTemporaryExpanded((current) => ({
          ...current,
          [targetMode]: { ...current[targetMode], [key]: next },
        }))
      } else {
        setHistoryGroupExpanded(targetMode, key, next)
      }
    },
    [filtering, isGroupExpanded, setHistoryGroupExpanded],
  )

  const refreshLocalDirectories = useCallback(async () => {
    const paths = allLocalGroups.map((group) => group.path).filter(Boolean)
    if (!paths.length || !window.ringcode?.historyCheckDirectories) {
      setLocalAvailability({})
      return
    }
    try {
      setLocalAvailability(await window.ringcode.historyCheckDirectories(paths))
    } catch {
      setLocalAvailability({})
    }
  }, [allLocalGroups])

  const refreshDiskGroups = useCallback(
    async (force = false) => {
      const api = window.ringcode
      if (!api?.historyGroups) return
      const scrollTop = historyListRef.current?.scrollTop ?? 0
      const requestId = ++diskGroupRequestId.current
      setDiskLoading(true)
      try {
        const groups = await api.historyGroups({ query, tool: toolFilter, refresh: force })
        if (requestId !== diskGroupRequestId.current) return
        setDiskGroupSummaries(groups)
        setDiskGeneration((value) => value + 1)
        requestAnimationFrame(() => {
          if (historyListRef.current) historyListRef.current.scrollTop = scrollTop
        })
      } catch {
        if (requestId === diskGroupRequestId.current) setDiskGroupSummaries([])
      } finally {
        if (requestId === diskGroupRequestId.current) setDiskLoading(false)
      }
    },
    [query, toolFilter],
  )

  const loadDiskGroup = useCallback(
    async (key: string, count: number) => {
      const api = window.ringcode
      if (!api?.historyListGroup) return
      const requestKey = `${diskGeneration}|${query}|${toolFilter}|${count}`
      setDiskPages((current) => ({
        ...current,
        [key]: {
          items: current[key]?.items ?? [],
          total: current[key]?.total ?? 0,
          loading: true,
          requestKey,
        },
      }))
      try {
        const page = await api.historyListGroup({
          directoryKey: key,
          query,
          tool: toolFilter,
          offset: 0,
          limit: count,
        })
        setDiskPages((current) => {
          if (current[key]?.requestKey !== requestKey) return current
          return { ...current, [key]: { ...page, loading: false, requestKey } }
        })
        const app = useAppStore.getState()
        for (const link of syncNativeHistoryTitles(app.sessions, page.items)) {
          app.linkNativeSession(link.sessionId, link.nativeSessionId, link.nativeTitle)
        }
      } catch {
        setDiskPages((current) => {
          if (current[key]?.requestKey !== requestKey) return current
          return { ...current, [key]: { ...current[key], loading: false } }
        })
      }
    },
    [diskGeneration, query, toolFilter],
  )

  useEffect(() => {
    const api = window.ringcode
    if (!api?.historySearch) return
    let cancelled = false
    const commands = Object.fromEntries(
      ['opencode'].map((tool) => [tool, profiles.find((profile) => profile.tool === tool)?.command || tool]),
    )
    void api.historySetContext({ commands, workspaces: workspaces.map((workspace) => workspace.path) })
      .then(() => api.historySearch('', 'all'))
      .then((results) => {
        if (cancelled) return
        const app = useAppStore.getState()
        for (const link of syncNativeHistoryTitles(app.sessions, results)) {
          app.linkNativeSession(link.sessionId, link.nativeSessionId, link.nativeTitle)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [profiles, workspaces])

  useEffect(() => {
    void refreshLocalDirectories()
  }, [refreshLocalDirectories])

  useEffect(() => {
    setTemporaryExpanded({ local: {}, disk: {} })
    setLocalLimits({})
    setDiskLimits({})
    setDiskPages({})
  }, [query, toolFilter])

  useEffect(() => {
    if (!diskMode) return
    const handle = setTimeout(() => void refreshDiskGroups(false), 300)
    return () => clearTimeout(handle)
  }, [diskMode, query, toolFilter, refreshDiskGroups])

  useEffect(() => {
    if (!diskMode) return
    const interval = setInterval(() => void refreshDiskGroups(true), 30_000)
    return () => clearInterval(interval)
  }, [diskMode, refreshDiskGroups])

  useEffect(() => {
    if (!diskMode) return
    for (const group of diskGroups) {
      if (!isGroupExpanded('disk', group.key)) continue
      const count = diskLimits[group.key] ?? PAGE_SIZE
      const expectedPrefix = `${diskGeneration}|${query}|${toolFilter}|${count}`
      if (diskPages[group.key]?.requestKey === expectedPrefix) continue
      void loadDiskGroup(group.key, count)
    }
  }, [diskMode, diskGroups, diskLimits, diskPages, diskGeneration, query, toolFilter, isGroupExpanded, loadDiskGroup])

  useEffect(() => {
    if (previousActiveSessionId.current === activeSessionId) return
    previousActiveSessionId.current = activeSessionId
    const session = sessions.find((item) => item.id === activeSessionId)
    if (session?.cwd) setHistoryGroupExpanded('local', normalizeHistoryPath(session.cwd), true)
  }, [activeSessionId, sessions, setHistoryGroupExpanded])

  useEffect(() => {
    if (!menu) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu])

  const linkedSession = (match: HistoryMatch) =>
    sessions.find((session) => session.tool === match.tool && session.nativeSessionId === match.sessionId)

  const titleForDisk = (match: HistoryMatch) =>
    displayTitle(historyAliases[historyAliasKey(match.tool, match.sessionId)] ?? match.title, match.snippet)

  const sessionForRef = (ref: HistoryRef): Session | undefined =>
    ref.kind === 'local' ? sessions.find((session) => session.id === ref.sessionId) : linkedSession(ref.match)

  const titleForRef = (ref: HistoryRef): string => {
    if (ref.kind === 'disk') return titleForDisk(ref.match)
    const session = sessions.find((item) => item.id === ref.sessionId)
    return session ? displayTitle(session.title, session.transcript) : '未命名会话'
  }

  const canResumeRef = (ref: HistoryRef): boolean =>
    ref.kind === 'disk' ? !!ref.match.sessionId : !!sessionForRef(ref)?.nativeSessionId

  const showBottom = () => {
    if (layout.bottomHidden) togglePanel('bottom')
  }

  const selectWorkspacePath = async (preferred: string): Promise<{ cwd: string; workspaceId: string } | null> => {
    const api = window.ringcode
    if (!api) {
      showToast('需桌面环境', 'error')
      return null
    }

    let cwd = preferred
    if (cwd) {
      try {
        await api.setWorkspaceRoots([...workspaces.map((workspace) => workspace.path), cwd].filter(Boolean))
        const stat = await api.fsStat(cwd, [])
        if (!stat?.isDir) cwd = ''
      } catch {
        cwd = ''
      }
    }
    if (!cwd) {
      showToast(preferred ? '原工作目录不可用，请选择替代目录' : '请选择会话工作目录', 'info')
      cwd = (await api.openDirectoryDialog()) ?? ''
      if (!cwd) return null
    }

    const current = useAppStore.getState().workspaces.find((workspace) => samePath(workspace.path, cwd))
    if (current) {
      switchWorkspace(current.id)
      return { cwd, workspaceId: current.id }
    }
    const created = addWorkspace(cwd, baseName(cwd))
    return { cwd, workspaceId: created.id }
  }

  const prepareLaunch = async (
    tool: string,
    cwd: string,
    workspaceId: string,
    preferredProfileId?: string,
    savedPermission?: PermissionChoice,
  ): Promise<{ profileId: string; permission?: PermissionChoice } | null> => {
    const app = useAppStore.getState()
    const api = window.ringcode
    const agent = agentById(tool, app.settings.customAgents ?? []) ?? { id: tool }
    const preferred = preferredProfileId ? app.getProfile(preferredProfileId) : undefined
    const profile = preferred ?? app.getProfileForTool(tool, workspaceId)
    const prepared = await prepareAgentLaunch(
      {
        agent,
        workspace: { path: cwd },
        profile,
        permissionByAgent: app.settings.launchPermissionByAgent ?? {},
        runtimeAvailable: !!api,
      },
      (command) => api!.envWhich(command),
    )
    if (!prepared.ok) {
      if (prepared.openSettings) app.openSettings('profiles', profile?.id)
      if (prepared.reason === 'profile') app.showToast(`请先配置 ${agentLabel(tool, extra)} 的启动方案`, 'error')
      else if (prepared.reason === 'executable') app.showToast(`未找到 ${profile?.command || tool}`, 'error')
      else app.showToast('当前环境无法启动本地 CLI', 'error')
      return null
    }
    return { profileId: prepared.profileId, permission: savedPermission ?? prepared.permission }
  }

  const resumeLocal = async (session: Session) => {
    if (!session.nativeSessionId) {
      showToast('该本地记录没有原生 session ID，不能继续原会话', 'error')
      return
    }
    const runningTerminal = session.status === 'running'
      ? terminals.find((terminal) => terminal.sessionId === session.id && !terminal.orphaned)
      : undefined
    if (runningTerminal) {
      setActiveTerminal(runningTerminal.id)
      setActiveSession(session.id)
      showBottom()
      showToast('该会话已在运行，已切换到现有终端', 'info')
      return
    }

    const workspace = await selectWorkspacePath(session.cwd)
    if (!workspace) return
    const launch = await prepareLaunch(
      session.tool,
      workspace.cwd,
      workspace.workspaceId,
      session.profileId,
      session.launchPermission,
    )
    if (!launch) return

    useAppStore.setState((state) => ({
      sessions: state.sessions.map((item) =>
        item.id === session.id
          ? {
              ...item,
              cwd: workspace.cwd,
              workspaceId: workspace.workspaceId,
              profileId: launch.profileId,
              launchPermission: launch.permission,
              status: 'running',
              endedAt: undefined,
              lastActiveAt: Date.now(),
            }
          : item,
      ),
      activeSessionId: session.id,
    }))
    newTerminal('ai', {
      tool: session.tool,
      sessionId: session.id,
      action: 'resume',
      sourceNativeSessionId: session.nativeSessionId,
      permission: launch.permission,
      title: `${agentLabel(session.tool, extra)} · 继续`,
    })
    showBottom()
    showToast(`正在继续：${displayTitle(session.title, session.transcript)}`, 'info')
  }

  const resumeDisk = async (match: HistoryMatch) => {
    const linked = linkedSession(match)
    if (linked) {
      await resumeLocal(linked)
      return
    }
    const workspace = await selectWorkspacePath(match.projectPath)
    if (!workspace) return
    const launch = await prepareLaunch(match.tool, workspace.cwd, workspace.workspaceId)
    if (!launch) return
    const app = useAppStore.getState()
    const title = titleForDisk(match)
    const session = app.createSession(match.tool, launch.profileId, workspace.cwd, {
      permission: launch.permission,
      title,
    })
    app.linkNativeSession(session.id, match.sessionId, title)
    app.newTerminal('ai', {
      tool: match.tool,
      sessionId: session.id,
      action: 'resume',
      sourceNativeSessionId: match.sessionId,
      permission: launch.permission,
      title: `${agentLabel(match.tool, extra)} · 继续`,
    })
    showBottom()
    showToast(`正在继续：${title}`, 'info')
  }

  const resumeRef = async (ref: HistoryRef) => {
    setMenu(null)
    if (ref.kind === 'disk') await resumeDisk(ref.match)
    else {
      const session = sessions.find((item) => item.id === ref.sessionId)
      if (session) await resumeLocal(session)
    }
  }

  const branchRef = async (ref: HistoryRef) => {
    setMenu(null)
    const local = ref.kind === 'local' ? sessions.find((session) => session.id === ref.sessionId) : linkedSession(ref.match)
    const tool = ref.kind === 'local' ? local?.tool : ref.match.tool
    const preferredCwd = ref.kind === 'local' ? local?.cwd ?? '' : ref.match.projectPath
    const sourceNativeSessionId = ref.kind === 'local' ? local?.nativeSessionId : ref.match.sessionId
    const sourceTitle = titleForRef(ref)
    if (!tool) return

    const workspace = await selectWorkspacePath(preferredCwd)
    if (!workspace) return
    const launch = await prepareLaunch(tool, workspace.cwd, workspace.workspaceId)
    if (!launch) return
    const agent = agentById(tool, useAppStore.getState().settings.customAgents ?? [])
    const useNativeFork = !!agent && supportsNativeFork(agent) && !!sourceNativeSessionId
    let initialPrompt: string | undefined

    if (!useNativeFork) {
      if (ref.kind === 'disk') {
        const raw = (await window.ringcode?.historyReadFile(ref.match.sessionFile)) ?? ''
        initialPrompt = buildBranchContext(sourceTitle, parseHistoryMessages(raw), historyFallbackText(raw))
      } else {
        initialPrompt = buildBranchContext(sourceTitle, [], local?.transcript ?? '')
      }
      if (!initialPrompt || initialPrompt.trim().split(/\r?\n/).length <= 2) {
        showToast('该记录没有可用于新会话的正文', 'error')
        return
      }
    }

    const app = useAppStore.getState()
    const session = app.createSession(tool, launch.profileId, workspace.cwd, {
      permission: launch.permission,
      sourceSessionId: local?.id,
      sourceTitle,
    })
    useAppStore.setState((state) => ({
      sessions: state.sessions.map((item) =>
        item.id === session.id ? { ...item, title: `${sourceTitle} · 分支`, autoTitled: true, nativeTitled: false } : item,
      ),
    }))
    app.newTerminal('ai', {
      tool,
      sessionId: session.id,
      action: useNativeFork ? 'fork' : 'new',
      sourceNativeSessionId: useNativeFork ? sourceNativeSessionId : undefined,
      initialPrompt,
      permission: launch.permission,
      title: `${agentLabel(tool, extra)} · 新分支`,
    })
    showBottom()
    showToast(useNativeFork ? '正在创建独立原生分支' : '已用旧会话上下文创建新会话', 'success')
  }

  const renameRef = async (ref: HistoryRef) => {
    setMenu(null)
    const current = titleForRef(ref)
    const title = await showPrompt('重命名会话', current)
    if (!title?.trim()) return
    if (ref.kind === 'local') renameSession(ref.sessionId, title.trim())
    else renameHistory(ref.match.tool, ref.match.sessionId, title.trim())
  }

  const exportSession = async () => {
    if (!active) return
    const api = window.ringcode
    if (!api) {
      showToast('导出需要桌面环境', 'error')
      return
    }
    const safeName = displayTitle(active.title, active.transcript).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
    const out = await api.saveTextFile(`${safeName}.md`, formatTranscript(active, extra))
    if (out) showToast(`已导出：${out}`, 'success')
  }

  const removeLocalSession = async (session: Session) => {
    if (!(await showConfirm(`删除会话「${displayTitle(session.title, session.transcript)}」？仅删除本机记录，不影响 CLI 磁盘历史。`))) return
    deleteSession(session.id)
    if (detail?.kind === 'local' && detail.sessionId === session.id) setDetail(null)
    showToast('已删除会话', 'info')
  }

  const removeActive = async () => {
    if (active) await removeLocalSession(active)
  }

  const removeHistoryRef = async (ref: HistoryRef) => {
    setMenu(null)
    if (ref.kind !== 'local') return
    const session = sessions.find((item) => item.id === ref.sessionId)
    if (session) await removeLocalSession(session)
  }

  const openSessionMenu = (event: React.MouseEvent, target: HistoryRef) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({
      kind: 'session',
      x: Math.min(event.clientX, window.innerWidth - 180),
      y: Math.min(event.clientY, window.innerHeight - 190),
      target,
    })
  }

  const openDirectoryMenu = (
    event: React.MouseEvent,
    targetMode: HistoryMode,
    group: { key: string; name: string; path: string; available: boolean; unknown: boolean },
  ) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({
      kind: 'directory',
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - 160),
      mode: targetMode,
      ...group,
      expanded: isGroupExpanded(targetMode, group.key),
    })
  }

  const copyDirectoryPath = async (path: string) => {
    setMenu(null)
    if (!path) return
    try {
      await navigator.clipboard.writeText(path)
      showToast('已复制目录路径', 'success')
    } catch {
      showToast('复制目录路径失败', 'error')
    }
  }

  const openDirectory = async (path: string) => {
    setMenu(null)
    if (!path || !(await window.ringcode?.historyOpenDirectory?.(path))) {
      showToast('目录不可用', 'error')
    }
  }

  const visibleGroups = diskMode ? diskGroups : localGroups
  const setAllVisible = (expanded: boolean) => {
    const keys = visibleGroups.map((group) => group.key)
    if (filtering) {
      setTemporaryExpanded((current) => ({
        ...current,
        [mode]: Object.fromEntries(keys.map((key) => [key, expanded])),
      }))
    } else {
      setVisibleHistoryGroupsExpanded(mode, keys, expanded)
    }
  }

  const refreshCurrentHistory = () => {
    if (diskMode) void refreshDiskGroups(true)
    else void refreshLocalDirectories()
  }

  const filters: Array<ToolType | 'all'> = ['all', ...agents.map((agent) => agent.id)]
  const detailTarget: HistoryDetailTarget | null = detail
    ? detail.kind === 'disk'
      ? { kind: 'disk', match: detail.match, title: titleForDisk(detail.match), linkedSession: linkedSession(detail.match) }
      : (() => {
          const session = sessions.find((item) => item.id === detail.sessionId)
          if (!session) return null
          const source = session.sourceSessionId ? sessions.find((item) => item.id === session.sourceSessionId) : undefined
          return {
            kind: 'local' as const,
            session,
            title: displayTitle(session.title, session.transcript),
            sourceTitle: session.sourceTitle ?? (source ? displayTitle(source.title, source.transcript) : undefined),
          }
        })()
    : null

  const renderLocalItem = (session: Session) => {
    const ref: HistoryRef = { kind: 'local', sessionId: session.id }
    return (
      <div
        key={session.id}
        className={`history-item ${session.id === activeSessionId ? 'active' : ''}`}
        onClick={() => setActiveSession(session.id)}
        onDoubleClick={() => setDetail(ref)}
        onContextMenu={(event) => openSessionMenu(event, ref)}
      >
        <div className="h-title">
          {session.favorite ? <span style={{ color: 'var(--warning)' }}>★</span> : null}
          <span className="history-title-text">{displayTitle(session.title, session.transcript)}</span>
          {session.nativeSessionId ? <span className="linked-badge">可继续</span> : null}
          <button className="history-more" onClick={(event) => openSessionMenu(event, ref)} aria-label="会话操作">…</button>
        </div>
        <div className="h-meta">
          <span><span className={`hdot ${STATUS_DOT[session.status]}`} />{STATUS_LABEL[session.status]}</span>
          <span>{agentLabel(session.tool, extra)}</span>
          <span>{timeAgo(session.lastActiveAt)}</span>
        </div>
      </div>
    )
  }

  const renderDiskItem = (match: HistoryMatch) => {
    const ref: HistoryRef = { kind: 'disk', match }
    const linked = linkedSession(match)
    return (
      <div
        key={match.sessionFile}
        className={`history-item ${selectedDiskFile === match.sessionFile ? 'active' : ''}`}
        onClick={() => setSelectedDiskFile(match.sessionFile)}
        onDoubleClick={() => setDetail(ref)}
        onContextMenu={(event) => openSessionMenu(event, ref)}
        title={match.projectPath}
      >
        <div className="h-title">
          <span className="history-agent-dot" />
          <span className="history-title-text">{titleForDisk(match)}</span>
          {linked ? <span className="linked-badge">已关联</span> : null}
          <button className="history-more" onClick={(event) => openSessionMenu(event, ref)} aria-label="会话操作">…</button>
        </div>
        <div className="h-meta">
          <span>{agentLabel(match.tool, extra)}</span>
          <span>{timeAgo(match.mtime)}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="right" style={{ width: '100%', height: '100%' }}>
      <div className="right-section current-session-section">
        <div className="title">当前会话</div>
        {active ? (
          <div className="session-card compact-session-card">
            <div className="compact-session-head">
              <div className="compact-session-title" title={displayTitle(active.title, active.transcript)}>
                {displayTitle(active.title, active.transcript)}
              </div>
              <span className={`hdot ${STATUS_DOT[active.status]}`} title={STATUS_LABEL[active.status]} />
            </div>
            <div className="compact-session-meta">
              <span>{agentLabel(active.tool, extra)}</span>
              <span title={active.cwd}>{activeWs?.name ?? baseName(active.cwd) ?? '-'}</span>
              <span>{activeProfile?.name ?? '-'}</span>
            </div>
            {active.sourceTitle ? <div className="session-source">基于《{active.sourceTitle}》创建</div> : null}
            <div className="compact-session-actions">
              <button className="btn" onClick={() => setDetail({ kind: 'local', sessionId: active.id })}>查看</button>
              <button className="btn" onClick={() => void branchRef({ kind: 'local', sessionId: active.id })}>基于此新建</button>
              <button
                className="btn primary"
                disabled={!active.nativeSessionId}
                title={active.nativeSessionId ? '' : '该记录尚未关联原生 session ID'}
                onClick={() => void resumeLocal(active)}
              >
                继续
              </button>
            </div>
            <div className="compact-session-actions secondary">
              <button className="text-action" onClick={() => toggleFavoriteSession(active.id)}>{active.favorite ? '取消收藏' : '收藏'}</button>
              <button className="text-action" onClick={() => void renameRef({ kind: 'local', sessionId: active.id })}>重命名</button>
              <button className="text-action" onClick={exportSession}>导出</button>
              <button className="text-action danger" onClick={removeActive}>删除</button>
            </div>
          </div>
        ) : (
          <div className="session-card" style={{ textAlign: 'center', color: 'var(--text-3)' }}>未选中会话</div>
        )}
      </div>

      <div className="right-section history-section">
        <div className="history-controls">
          <div className="history-heading-row">
            <div className="title">历史会话</div>
            <div className="history-heading-actions">
              <button onClick={refreshCurrentHistory} title="刷新当前历史" aria-label="刷新当前历史">↻</button>
              <button onClick={() => setAllVisible(true)} title="全部展开">展开</button>
              <button onClick={() => setAllVisible(false)} title="全部折叠">折叠</button>
            </div>
          </div>
          <div className="filter-row" style={{ marginBottom: 8 }}>
            <button className={`chip ${!diskMode ? 'active' : ''}`} onClick={() => setDiskMode(false)}>本机会话</button>
            <button className={`chip ${diskMode ? 'active' : ''}`} onClick={() => setDiskMode(true)}>磁盘历史</button>
          </div>
          <div className="search-box">
            <span style={{ color: 'var(--text-3)', fontSize: 12 }}>⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题 / 正文 / 目录" />
          </div>
          <div className="filter-row" style={{ flexWrap: 'wrap' }}>
            {filters.map((tool) => (
              <button key={tool} className={`chip ${toolFilter === tool ? 'active' : ''}`} onClick={() => setToolFilter(tool)}>
                {tool === 'all' ? '全部' : agentLabel(tool, extra)}
              </button>
            ))}
          </div>
        </div>

        <div className="history-list" ref={historyListRef}>
          {diskMode ? (
            diskLoading && !diskGroups.length ? (
              <div className="empty-state"><div className="emoji">⏳</div><div>正在建立磁盘历史目录索引…</div></div>
            ) : diskGroups.length === 0 ? (
              <div className="empty-state">
                <div className="emoji">🗂️</div>
                <div>{filtering ? '无匹配会话' : '未找到磁盘历史'}</div>
                <div className="history-roots">Claude · Codex · OpenCode · Antigravity CLI · Hermes</div>
              </div>
            ) : (
              diskGroups.map((group) => {
                const expanded = isGroupExpanded('disk', group.key)
                const page = diskPages[group.key]
                const items = page?.items ?? []
                return (
                  <HistoryDirectorySection
                    key={group.key}
                    name={group.name}
                    path={group.path}
                    relation={group.relation}
                    totalCount={group.totalCount}
                    matchedCount={group.matchedCount}
                    latestAt={group.latestMtime}
                    available={group.available}
                    unknown={group.unknown}
                    expanded={expanded}
                    filtering={filtering}
                    loading={expanded && (!!page?.loading || !page)}
                    hasMore={items.length < group.matchedCount}
                    onToggle={() => toggleGroup('disk', group.key)}
                    onMenu={(event) => openDirectoryMenu(event, 'disk', group)}
                    onLoadMore={() => {
                      const next = (diskLimits[group.key] ?? PAGE_SIZE) + PAGE_SIZE
                      setDiskLimits((current) => ({ ...current, [group.key]: next }))
                    }}
                    formatTime={timeAgo}
                  >
                    {items.map(renderDiskItem)}
                  </HistoryDirectorySection>
                )
              })
            )
          ) : localGroups.length === 0 ? (
            <div className="empty-state"><div className="emoji">🗂️</div><div>{filtering ? '无匹配会话' : '暂无历史会话'}</div></div>
          ) : (
            localGroups.map((group) => {
              const expanded = isGroupExpanded('local', group.key)
              const visibleCount = localLimits[group.key] ?? PAGE_SIZE
              const items = pageHistoryItems(group.items, visibleCount)
              const unknown = group.relation === 'unknown'
              const available = unknown ? false : (localAvailability[group.key] ?? true)
              return (
                <HistoryDirectorySection
                  key={group.key}
                  name={group.name}
                  path={group.path}
                  relation={group.relation}
                  totalCount={group.totalCount}
                  matchedCount={group.matchedCount}
                  latestAt={group.latestAt}
                  available={available}
                  unknown={unknown}
                  expanded={expanded}
                  filtering={filtering}
                  hasMore={items.length < group.matchedCount}
                  onToggle={() => toggleGroup('local', group.key)}
                  onMenu={(event) => openDirectoryMenu(event, 'local', {
                    key: group.key,
                    name: group.name,
                    path: group.path,
                    available,
                    unknown,
                  })}
                  onLoadMore={() => setLocalLimits((current) => ({
                    ...current,
                    [group.key]: (current[group.key] ?? PAGE_SIZE) + PAGE_SIZE,
                  }))}
                  formatTime={timeAgo}
                >
                  {items.map(renderLocalItem)}
                </HistoryDirectorySection>
              )
            })
          )}
        </div>
      </div>

      {menu ? (
        <>
          <div className="ctx-backdrop" onClick={() => setMenu(null)} onContextMenu={(event) => { event.preventDefault(); setMenu(null) }} />
          <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
            {menu.kind === 'session' ? (
              <>
                <button className="ctx-item" onClick={() => { setDetail(menu.target); setMenu(null) }}>查看详情</button>
                <button className="ctx-item" disabled={!canResumeRef(menu.target)} title={canResumeRef(menu.target) ? '' : '当前记录不支持继续会话'} onClick={() => void resumeRef(menu.target)}>继续会话</button>
                <button className="ctx-item" onClick={() => void branchRef(menu.target)}>基于此新建</button>
                <button className="ctx-item" onClick={() => void renameRef(menu.target)}>重命名</button>
                {menu.target.kind === 'local' ? (
                  <button className="ctx-item danger" onClick={() => void removeHistoryRef(menu.target)}>删除本地记录</button>
                ) : null}
              </>
            ) : (
              <>
                <button className="ctx-item" onClick={() => { toggleGroup(menu.mode, menu.key); setMenu(null) }}>
                  {menu.expanded ? '折叠此目录' : '展开此目录'}
                </button>
                <button className="ctx-item" disabled={!menu.available || menu.unknown} onClick={() => void openDirectory(menu.path)}>
                  在资源管理器中打开
                </button>
                <button className="ctx-item" disabled={menu.unknown || !menu.path} onClick={() => void copyDirectoryPath(menu.path)}>
                  复制完整路径
                </button>
              </>
            )}
          </div>
        </>
      ) : null}

      {detailTarget && detail ? (
        <SessionHistoryModal
          target={detailTarget}
          canResume={canResumeRef(detail)}
          onClose={() => setDetail(null)}
          onResume={() => {
            const target = detail
            setDetail(null)
            void resumeRef(target)
          }}
          onBranch={() => {
            const target = detail
            setDetail(null)
            void branchRef(target)
          }}
          onRename={() => void renameRef(detail)}
        />
      ) : null}
    </div>
  )
}
