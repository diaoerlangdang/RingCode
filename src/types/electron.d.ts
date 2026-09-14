// 渲染层可选的原生 API（仅在 Electron 环境下存在；web 下为 undefined）
import type { FsEntry, GitStatus, GitLogEntry, Skill, SearchMatch, HistoryMatch, HistoryDirectoryGroup, HistoryGroupPage, HistoryFilePage } from '@/types'

export interface PtySpawnOpts {
  exe: string
  args: string[]
  cwd: string
  env?: Record<string, string>
  cols: number
  rows: number
  credentialRef?: string
  sensitiveEnvKeys?: string[]
  unsetEnvKeys?: string[]
  credentialEnv?: string
  requireCredential?: boolean
  extraEnv?: Record<string, string>
  cloneId?: string
  codexOverlay?: { cloneId: string; profileName: string; content: string }
}

export interface RingCodeApi {
  platform: string
  versions: { electron: string; chrome: string; node: string }
  isElectron: boolean
  readClipboardText: () => string
  openDirectoryDialog: () => Promise<string | null>
  revealInExplorer: (p: string) => Promise<void>
  saveTextFile: (defaultName: string, content: string) => Promise<string | null>
  showNotification: (title: string, body: string) => Promise<void>
  openTextFile: () => Promise<{ name: string; content: string } | null>
  credSet: (key: string, val: string) => Promise<boolean>
  credHas: (key: string) => Promise<boolean>
  credDelete: (key: string) => Promise<boolean>
  registerOwnedResource: (item: {
    kind: 'credential' | 'codexOverlay' | 'launcher' | 'snapshot'
    id?: string
    path?: string
    cloneId: string
    profileName?: string
    commandName?: string
  }) => Promise<boolean>
  writeCodexOverlay: (input: {
    cloneId: string
    profileName: string
    content: string
  }) => Promise<{ ok: true; path: string } | { ok: false; reason: string }>
  cloneSync: (input: {
    snapshot: {
      version: 1
      cloneId: string
      commandName: string
      name: string
      family: 'claude' | 'codex'
      command: string
      model: string
      modelMode: 'default' | 'custom'
      baseUrl: string
      permission?: 'default' | 'auto' | 'dangerous'
      credentialRef: string
      codexProfileName?: string
      updatedAt: number
    }
  }) => Promise<{
    snapshot: { ok: true; path: string } | { ok: false; reason: string }
    launcher: { ok: true; path: string } | { ok: false; reason: string }
    appLaunch: { ok: true; path: string } | { ok: false; reason: string }
  }>
  cloneLauncherStatus: (input: {
    cloneId: string
    commandName: string
  }) => Promise<{ ok: boolean; path: string; reason?: string }>
  cloneOpenBin: () => Promise<boolean>
  cloneDelete: (cloneId: string) => Promise<{ ok: boolean; results: Array<{ ok: boolean; target: string; reason?: string }>; reason?: string }>
  cloneClearKey: (cloneId: string) => Promise<{ ok: boolean; results: Array<{ ok: boolean; target: string; reason?: string }>; reason?: string }>
  cloneClearAll: () => Promise<{ ok: boolean; results: Array<{ ok: boolean; target: string; reason?: string }>; reason?: string }>
  cloneRunning: (cloneId?: string) => Promise<boolean>
  storeGet: (key: string) => Promise<string | null>
  storeSet: (key: string, value: string) => Promise<void>
  storeDel: (key: string) => Promise<void>
  envWhich: (exe: string) => Promise<boolean>
  // 真实文件系统（主进程 Node fs）
  fsList: (rootPath: string, segments: string[]) => Promise<FsEntry[]>
  fsReadText: (rootPath: string, segments: string[]) => Promise<string | null>
  fsReadDataUrl: (rootPath: string, segments: string[]) => Promise<string | null>
  fsWriteText: (rootPath: string, segments: string[], content: string) => Promise<void>
  fsMkdir: (rootPath: string, segments: string[]) => Promise<void>
  fsRename: (rootPath: string, segments: string[], newName: string) => Promise<void>
  fsDelete: (rootPath: string, segments: string[]) => Promise<void>
  /** 列出本机可用磁盘根目录（如 ['C:\\','D:\\']），用于左侧「此电脑」 */
  fsListDrives: () => Promise<string[]>
  fsStat: (rootPath: string, segments: string[]) => Promise<{ mtime: number; size: number; isDir: boolean } | null>
  fsCopy: (rootPath: string, segments: string[], destName: string) => Promise<void>
  /** 复制文件/文件夹（递归）到目标目录，destSegments 为完整目标路径（含名称） */
  fsCopyTo: (rootPath: string, srcSegments: string[], destRootPath: string, destSegments: string[]) => Promise<void>
  /** 移动（剪切）文件/文件夹到目标目录，destSegments 为完整目标路径（含名称） */
  fsMoveTo: (rootPath: string, srcSegments: string[], destRootPath: string, destSegments: string[]) => Promise<void>
  fsWatch: (rootPath: string) => Promise<boolean>
  fsUnwatch: () => Promise<void>
  onFsChanged: (cb: (payload: { event: string; filename: string; rootPath: string }) => void) => () => void
  openExeDialog: () => Promise<string | null>
  setWorkspaceRoots: (roots: string[]) => Promise<void>
  // 真实终端（主进程 node-pty）
  ptySpawn: (opts: PtySpawnOpts) => Promise<string>
  ptyInput: (ptyId: string, data: string) => void
  ptyResize: (ptyId: string, cols: number, rows: number) => void
  ptyDispose: (ptyId: string) => void
  onPtyData: (cb: (ptyId: string, data: string) => void) => () => void
  onPtyExit: (cb: (ptyId: string, code: number) => void) => () => void
  // Git（GIT-001/002/003/004）
  gitStatus: (cwd: string) => Promise<GitStatus>
  gitDiff: (cwd: string, opts: { staged?: boolean; path?: string }) => Promise<string>
  gitStage: (cwd: string, paths: string[]) => Promise<void>
  gitUnstage: (cwd: string, paths: string[]) => Promise<void>
  gitCommit: (cwd: string, message: string) => Promise<void>
  gitLog: (cwd: string, limit?: number) => Promise<GitLogEntry[]>
  gitBranches: (cwd: string) => Promise<{ name: string; current: boolean }[]>
  gitCheckout: (cwd: string, branch: string) => Promise<void>
  // Skill 库（SKL-001/002/003）
  skillImport: (srcPath: string, scope: 'global' | 'workspace', workspaceId?: string) => Promise<Skill>
  skillReadContent: (id: string) => Promise<string | null>
  skillDelete: (id: string) => Promise<boolean>
  // 工作区搜索（FIL-004）
  searchWorkspace: (rootPath: string, query: string, mode: 'content' | 'filename') => Promise<SearchMatch[]>
  historySetContext: (input: { commands: Record<string, string>; workspaces: string[] }) => Promise<void>
  historySearch: (query: string, tool?: string) => Promise<HistoryMatch[]>
  historyGroups: (input?: { query?: string; tool?: string; refresh?: boolean }) => Promise<HistoryDirectoryGroup[]>
  historyListGroup: (input: {
    directoryKey: string
    query: string
    tool: string
    offset: number
    limit: number
  }) => Promise<HistoryGroupPage>
  historyCheckDirectories: (directories: string[]) => Promise<Record<string, boolean>>
  historyOpenDirectory: (directory: string) => Promise<boolean>
  historyFindRecent: (input: {
    tool: string
    projectPath: string
    startedAt: number
    excludeSessionId?: string
    sessionId?: string
  }) => Promise<HistoryMatch | null>
  historyReadSession: (tool: string, sessionId: string) => Promise<string | null>
  historyReadFile: (file: string) => Promise<string | null>
  historyReadSessionPage: (tool: string, sessionId: string, before?: number) => Promise<HistoryFilePage | null>
  historyReadFilePage: (file: string, before?: number) => Promise<HistoryFilePage | null>
}

declare global {
  interface Window {
    ringcode?: RingCodeApi
  }
}

export {}
