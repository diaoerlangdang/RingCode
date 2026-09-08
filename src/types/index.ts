// 金刚琢核心类型，对应 PRD §8.1 本地数据实体

/** Agent id：内置 claude / codex / opencode / antigravity / hermes，或用户在设置里添加的自定义 id */
export type ToolType = string
export type SessionStatus = 'running' | 'ended' | 'interrupted' | 'failed'
export type ProfileScope = 'global' | 'workspace'
export type TerminalStrategy = 'new' | 'reuse-idle'
export type ThemeMode = 'dark' | 'light' | 'system'
export type TerminalKind = 'shell' | 'ai'
export type PermissionChoice = 'default' | 'auto' | 'dangerous'
export type ModelMode = 'default' | 'custom'
export type SessionLaunchAction = 'new' | 'resume' | 'fork'
export type SettingsTab = 'general' | 'profiles' | 'agents' | 'keys'

/** Agent 适配器：内置写在 src/lib/agents.ts，自定义存 settings.customAgents */
export interface AgentDef {
  id: string
  name: string
  command: string
  icon: string
  /** 纯黑单色字形(透明底)置 'mono'，深色主题下自动 invert 保持可见；彩色品牌图不设 */
  iconMode?: 'mono' | 'color'
  accent: string
  credentialEnv?: string
  credentialRef?: string
  defaultModel?: string
  /** 指定模型时使用的 argv 模板；{model} 会替换为配置方案中的模型。 */
  modelArgs?: string[]
  setupUrl?: string
  shortcutDigit?: string
  /** 兼容旧的自定义 Agent 配置；内置 Agent 使用 session.resumeArgs */
  resumeFlag?: string
  /** 原生会话能力。{id} 在启动时替换为原生 session id。 */
  session?: {
    resumeArgs: string[]
    forkArgs?: string[]
  }
  /** “基于此新建”降级时，首条上下文的传递方式。 */
  initialPrompt?:
    | { mode: 'args'; args: string[] }
    | { mode: 'stdin' }
  historyRoots: string[]
  permission?: {
    autoArgs: string[]
    dangerousArgs: string[]
    autoLabel: string
    dangerousLabel: string
  }
}

/** 工作区（PRD WSP） */
export interface Workspace {
  id: string
  path: string
  name: string
  lastOpenedAt: number
  favorite?: boolean
  /** 演示用工作区，文件来自内置 mock 文件系统 */
  mock?: boolean
}

/** 环境变量引用：真实凭据不落此结构，只存引用名与是否已设置 */
export interface EnvVar {
  key: string
  /** 引用名或占位文本；敏感值仅显示掩码 */
  value: string
  sensitive?: boolean
}

/** 运行配置方案（PRD AIT-004 / CFG） */
export interface ToolProfile {
  id: string
  name: string
  scope: ProfileScope
  workspaceId?: string
  tool: ToolType
  command: string
  args: string
  model: string
  /** default 不传模型参数；custom 才使用 model。旧配置迁移时一律回到 default。 */
  modelMode?: ModelMode
  cwd?: string
  envs: EnvVar[]
  terminalStrategy: TerminalStrategy
  /** Windows Credential Manager 中的键名，不存明文 */
  credentialRef?: string
  credentialSet?: boolean
}

/** AI 会话（PRD §6.7.1） */
export interface Session {
  id: string
  title: string
  tool: ToolType
  workspaceId: string
  profileId: string
  cwd: string
  status: SessionStatus
  createdAt: number
  lastActiveAt: number
  endedAt?: number
  /** 清理后的可搜索文本记录 */
  transcript: string
  nativeSessionId?: string
  resumable: boolean
  /** 本次会话实际使用的权限模式，恢复本地会话时复用 */
  launchPermission?: PermissionChoice
  /** “基于此记录新建”的来源 RingCode Session */
  sourceSessionId?: string
  /** 来源只有磁盘历史时保存显示标题 */
  sourceTitle?: string
  favorite?: boolean
  /** 标题是否仍为自动生成（用户重命名后置 false） */
  autoTitled?: boolean
  /** 标题已来自 Agent 原生总结；仍允许被更新的原生标题覆盖，但不再被终端启发式覆盖 */
  nativeTitled?: boolean
  /** 是否已提交过实际对话；false 的新建会话在关闭终端时可自动清理 */
  conversationStarted?: boolean
}

/** 终端标签 */
export interface TerminalTab {
  id: string
  title: string
  kind: TerminalKind
  tool?: ToolType
  sessionId?: string
  /** 启动动作：新建、恢复原生上下文或创建原生分支 */
  action?: SessionLaunchAction
  /** resume/fork 使用的来源原生 session id；fork 时不能写入新 Session.nativeSessionId */
  sourceNativeSessionId?: string
  /** Agent 不支持原生分支时，启动后自动写入的有界上下文 */
  initialPrompt?: string
  /** @deprecated 由 action 替代；旧快照 resume=true 视为 resume */
  resume?: boolean
  /** @deprecated 由 permission 替代；hydrate 时 autoMode=true 视为 auto */
  autoMode?: boolean
  /** 启动权限：default / auto / dangerous（Claude 危险启动、Hermes YOLO） */
  permission?: PermissionChoice
  /** 应用重启后进程不恢复；为 true 时不得自动 spawn（TRM-006） */
  orphaned?: boolean
  createdAt: number
}

/** 布局状态（PRD UI-001/006） */
export interface LayoutState {
  leftWidth: number
  rightWidth: number
  /** 中区文件管理器占比 0..1 */
  centerSplit: number
  leftHidden: boolean
  rightHidden: boolean
  bottomHidden: boolean
  /** 终端左右分屏（TRM-004） */
  terminalSplit?: boolean
  /** 编辑器与预览并排（EDT-005） */
  editorPreviewSplit?: boolean
}

/** 命名布局预设（UI-007） */
export interface SavedLayout {
  id: string
  name: string
  layout: LayoutState
}

export interface AppSettings {
  theme: ThemeMode
  defaultTool: ToolType
  saveTranscript: boolean
  transcriptRetentionDays: number
  /** 首启向导是否已完成 */
  firstRunDone: boolean
  /** 用户自定义 Agent（AIT-009）；内置 Agent 不在此列 */
  customAgents?: AgentDef[]
  /** 命令 id -> 快捷键规格，如 Ctrl+Shift+1 */
  keymap?: Record<string, string>
  /** 普通终端可执行文件：powershell.exe / cmd.exe / bash.exe */
  shellExe?: string
  /** Agent id -> 直接启动时使用的权限模式 */
  launchPermissionByAgent?: Record<string, PermissionChoice>
}

/** 最近打开的文件（左栏「最近」） */
export interface RecentFile {
  name: string
  segments: string[]
  workspaceId: string
  workspacePath: string
  at: number
}

/** Toast 通知 */
export interface ToastMsg {
  id: string
  text: string
  level?: 'info' | 'success' | 'error'
}

/** 文件系统条目（文件管理器统一结构） */
export interface FsEntry {
  name: string
  isDir: boolean
  size?: number
  modified?: number
}

/** Git 文件状态码条目（GIT-001） */
export interface GitFile {
  path: string
  oldPath?: string
  /** index（暂存区）状态码：M/A/D/R/C/?/空格 */
  index: string
  /** 工作树状态码 */
  worktree: string
  staged: boolean
}

/** Git 仓库状态（GIT-001） */
export interface GitStatus {
  isRepo: boolean
  branch: string
  ahead: number
  behind: number
  files: GitFile[]
}

/** Git 提交历史条目 */
export interface GitLogEntry {
  hash: string
  author: string
  date: string
  message: string
}

/** 工作区搜索结果条目（FIL-004） */
export interface SearchMatch {
  /** 相对路径（posix 分隔符） */
  path: string
  /** 1-based 行号；filename 模式为 0 */
  line: number
  /** 匹配行内容（content 模式）；filename 模式为文件名 */
  text: string
}

/** 磁盘历史会话搜索结果（HIS-014，扫描 ~/.claude/projects 等） */
export interface HistoryMatch {
  /** 来源工具（内置 Agent 或自定义 id） */
  tool: string
  /** 会话所属项目真实路径（取自事件 cwd） */
  projectPath: string
  /** jsonl 文件绝对路径 */
  sessionFile: string
  /** Agent 原生 session id（优先取事件字段，文件名仅作兜底） */
  sessionId: string
  /** 标题：Agent 原生总结（Claude ai-title、Codex thread_name、OpenCode title），缺失时使用首条有效用户消息 */
  title: string
  /** 命中片段 */
  snippet: string
  /** 会话首次落盘时间（ms），用于与 RingCode 本地 Session 对齐 */
  startedAt: number
  /** 文件修改时间（ms） */
  mtime: number
}

export interface HistoryDirectoryGroup {
  key: string
  path: string
  name: string
  totalCount: number
  matchedCount: number
  latestMtime: number
  available: boolean
  unknown: boolean
}

export interface HistoryGroupPage {
  items: HistoryMatch[]
  total: number
}

export interface HistoryFilePage {
  content: string
  /** 本页在 JSONL 文件中的起始字节偏移；加载更早记录时作为 before 传回。 */
  start: number
  end: number
  hasMore: boolean
}

export type SkillScope = 'global' | 'workspace'

/** Skill 库条目（PRD §6.9 / §8.1 Skill 实体） */
export interface Skill {
  id: string
  name: string
  description: string
  /** 来源类型：本地文件夹或 Git 仓库（SKL-008 推迟） */
  source: 'local' | 'git'
  /** 原始来源路径，仅用于展示 */
  sourcePath: string
  scope: SkillScope
  /** scope=workspace 时所属工作区 */
  workspaceId?: string
  /** 内容指纹（SHA-256，覆盖全部文件的相对路径+内容） */
  fingerprint: string
  fileCount: number
  totalSize: number
  createdAt: number
  updatedAt: number
}
