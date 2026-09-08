import { useAppStore } from '@/store/useAppStore'
import { useFsStore } from '@/store/useFsStore'
import { isFsAccessSupported, pickDirectory } from '@/lib/fs'
import { listAgents, agentById } from '@/lib/agents'
import { prepareAgentLaunch } from '@/lib/agentLaunch'
import { DEFAULT_KEYMAP } from '@/lib/keymap'

export interface CommandDef {
  id: string
  group: string
  label: string
  shortcut?: string
}

function shortcutOf(id: string, keymap?: Record<string, string>): string | undefined {
  return keymap?.[id] || DEFAULT_KEYMAP[id]
}

/** 命令清单（含当前已注册 Agent），对应 design-brief §4.2 */
export function getCommands(): CommandDef[] {
  const st = useAppStore.getState()
  const agents = listAgents(st.settings.customAgents ?? [])
  const km = st.settings.keymap
  return [
    { id: 'workspace.open', group: '工作区', label: '打开文件夹…' },
    ...agents.map((a) => ({
      id: `ai.${a.id}`,
      group: 'AI 会话',
      label: `启动 ${a.name}`,
      shortcut: shortcutOf(`ai.${a.id}`, km) || (a.shortcutDigit ? `Ctrl+Shift+${a.shortcutDigit}` : undefined),
    })),
    { id: 'ai.history', group: 'AI 会话', label: '搜索历史会话', shortcut: shortcutOf('ai.history', km) },
    { id: 'terminal.new', group: '终端', label: '新建终端', shortcut: shortcutOf('terminal.new', km) },
    { id: 'file.quickOpen', group: '文件', label: '快速打开文件', shortcut: shortcutOf('file.quickOpen', km) },
    { id: 'file.search', group: '文件', label: '内容搜索', shortcut: shortcutOf('file.search', km) },
    { id: 'view.theme', group: '视图', label: '切换主题', shortcut: 'Ctrl+K Ctrl+T' },
    { id: 'view.toggleLeft', group: '视图', label: '切换左侧栏', shortcut: shortcutOf('view.toggleLeft', km) },
    { id: 'view.toggleRight', group: '视图', label: '切换右侧栏', shortcut: shortcutOf('view.toggleRight', km) },
    { id: 'view.toggleBottom', group: '视图', label: '切换底部终端', shortcut: shortcutOf('view.toggleBottom', km) },
    { id: 'view.resetLayout', group: '视图', label: '重置布局' },
    { id: 'skill.view', group: 'Skill', label: '打开 Skill 库' },
    { id: 'skill.import', group: 'Skill', label: '导入 Skill 文件夹…' },
    { id: 'view.settings', group: '设置', label: '打开设置' },
  ]
}

/** @deprecated 用 getCommands()，保留给静态引用 */
export const COMMANDS: CommandDef[] = getCommands()

/** 执行命令。使用 store getState，可在任意位置调用（含快捷键、命令面板）。 */
export async function runCommand(id: string): Promise<void> {
  const app = useAppStore.getState()
  const fs = useFsStore.getState()
  if (id.startsWith('ai.') && id !== 'ai.history') {
    const agentId = id.slice(3)
    const agent = agentById(agentId, app.settings.customAgents ?? []) ?? { id: agentId }
    const workspace = app.workspaces.find((w) => w.id === app.activeWorkspaceId)
    const profile = app.getProfileForTool(agentId, app.activeWorkspaceId ?? undefined)
    const api = window.ringcode
    const prepared = await prepareAgentLaunch(
      {
        agent,
        workspace,
        profile,
        permissionByAgent: app.settings.launchPermissionByAgent ?? {},
        runtimeAvailable: !!api,
      },
      (command) => api!.envWhich(command),
    )
    const name = 'name' in agent ? agent.name : agentId
    if (!prepared.ok) {
      if (prepared.openSettings) app.openSettings('profiles', profile?.id)
      if (prepared.reason === 'workspace') app.showToast('请先打开工作区', 'error')
      else if (prepared.reason === 'profile') app.showToast(`请先配置 ${name} 的启动命令`, 'error')
      else if (prepared.reason === 'executable') app.showToast(`未找到 ${profile?.command || name}，请检查可执行文件配置`, 'error')
      else app.showToast('当前环境无法启动本地 CLI', 'error')
      return
    }
    try {
      await api!.setWorkspaceRoots(app.workspaces.map((w) => w.path).filter(Boolean))
    } catch {
      /* TerminalView 会再次登记；失败时由终端显示具体原因 */
    }
    const session = app.createSession(agentId, prepared.profileId, prepared.cwd, { permission: prepared.permission })
    app.newTerminal('ai', { tool: agentId, sessionId: session.id, action: 'new', permission: prepared.permission })
    if (app.layout.bottomHidden) app.togglePanel('bottom')
    const permissionHint =
      prepared.permission === 'dangerous' ? '（危险模式）' : prepared.permission === 'auto' ? '（Auto）' : ''
    app.showToast(`${name} 已启动${permissionHint}`, 'success')
    return
  }
  switch (id) {
    case 'workspace.open': {
      if (!isFsAccessSupported()) {
        app.showToast('当前环境不支持本地目录访问', 'info')
        return
      }
      const h = await pickDirectory()
      if (!h) return
      const name = h.kind === 'mock' ? 'workspace' : h.name
      const path = h.kind === 'electron' ? h.rootPath : h.kind === 'real' ? h.handle.name : name
      app.addWorkspace(path, name)
      fs.setHandle(h, name)
      app.showToast(`已打开工作区：${name}`, 'success')
      break
    }
    case 'ai.history':
      app.setHistoryDiskMode(true)
      if (app.layout.rightHidden) app.togglePanel('right')
      break
    case 'terminal.new':
      app.newTerminal('shell', { title: app.settings.shellExe?.replace(/\.exe$/i, '') || 'powershell' })
      app.showToast('已新建终端', 'info')
      break
    case 'file.quickOpen':
      app.setCenterTopTab('fm')
      app.showToast('在文件管理器中双击文件打开', 'info')
      break
    case 'file.search':
      app.setCenterTopTab('search')
      break
    case 'view.theme':
      app.setTheme(app.resolveTheme() === 'dark' ? 'light' : 'dark')
      break
    case 'view.toggleLeft':
      app.togglePanel('left')
      break
    case 'view.toggleRight':
      app.togglePanel('right')
      break
    case 'view.toggleBottom':
      app.togglePanel('bottom')
      break
    case 'view.settings':
      app.openSettings()
      break
    case 'view.resetLayout':
      app.setLayout({
        leftWidth: 250,
        rightWidth: 300,
        centerSplit: 0.4,
        leftHidden: false,
        rightHidden: false,
        bottomHidden: false,
        terminalSplit: false,
        editorPreviewSplit: false,
      })
      app.showToast('布局已重置', 'info')
      break
    case 'skill.view':
      app.setCenterTopTab('skills')
      break
    case 'skill.import':
      app.setCenterTopTab('skills')
      app.showToast('请在 Skill 标签页点击“导入 Skill 文件夹”', 'info')
      break
  }
}
