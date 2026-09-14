// 金刚琢 preload：通过 contextBridge 暴露受控 API，渲染层不得直接访问 Node（§9.2）

import { clipboard, contextBridge, ipcRenderer } from 'electron'

const api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  isElectron: true,
  readClipboardText: (): string => clipboard.readText(),
  // 原生目录选择（备选 FS Access API）
  openDirectoryDialog: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory'),
  revealInExplorer: (p: string): Promise<void> => ipcRenderer.invoke('shell:revealInExplorer', p),
  saveTextFile: (defaultName: string, content: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveText', defaultName, content),
  showNotification: (title: string, body: string): Promise<void> => ipcRenderer.invoke('notify:show', title, body),
  openTextFile: (): Promise<{ name: string; content: string } | null> => ipcRenderer.invoke('dialog:openText'),
  // 凭据：渲染层只能 has/set/delete，明文读取仅主进程注入 PTY
  credSet: (key: string, val: string): Promise<boolean> => ipcRenderer.invoke('cred:set', key, val),
  credHas: (key: string): Promise<boolean> => ipcRenderer.invoke('cred:has', key),
  credDelete: (key: string): Promise<boolean> => ipcRenderer.invoke('cred:delete', key),
  registerOwnedResource: (item: unknown): Promise<boolean> => ipcRenderer.invoke('resources:register', item),
  writeCodexOverlay: (input: unknown): Promise<{ ok: true; path: string } | { ok: false; reason: string }> =>
    ipcRenderer.invoke('codex:writeOverlay', input),
  cloneSync: (input: unknown) => ipcRenderer.invoke('clone:sync', input),
  cloneLauncherStatus: (input: unknown) => ipcRenderer.invoke('clone:launcherStatus', input),
  cloneOpenBin: () => ipcRenderer.invoke('clone:openBin'),
  cloneDelete: (cloneId: string) => ipcRenderer.invoke('clone:delete', cloneId),
  cloneClearKey: (cloneId: string) => ipcRenderer.invoke('clone:clearKey', cloneId),
  cloneClearAll: () => ipcRenderer.invoke('clone:clearAll'),
  cloneRunning: (cloneId?: string) => ipcRenderer.invoke('clone:running', cloneId),
  cloneListModels: (input: {
    family: 'claude' | 'codex'
    baseUrl?: string
    apiKey?: string
    credentialRef?: string
  }) => ipcRenderer.invoke('clone:listModels', input),
  // 本地数据库（主进程 better-sqlite3）
  storeGet: (key: string): Promise<string | null> => ipcRenderer.invoke('store:get', key),
  storeSet: (key: string, value: string): Promise<void> => ipcRenderer.invoke('store:set', key, value),
  storeDel: (key: string): Promise<void> => ipcRenderer.invoke('store:del', key),
  // 环境检测（CLI 是否在 PATH）
  envWhich: (exe: string): Promise<boolean> => ipcRenderer.invoke('env:which', exe),
  // 真实文件系统（主进程 Node fs）
  fsList: (rootPath: string, segments: string[]) => ipcRenderer.invoke('fs:list', rootPath, segments),
  fsReadText: (rootPath: string, segments: string[]) => ipcRenderer.invoke('fs:readText', rootPath, segments),
  fsReadDataUrl: (rootPath: string, segments: string[]) => ipcRenderer.invoke('fs:readDataUrl', rootPath, segments),
  fsWriteText: (rootPath: string, segments: string[], content: string) =>
    ipcRenderer.invoke('fs:writeText', rootPath, segments, content),
  fsMkdir: (rootPath: string, segments: string[]) => ipcRenderer.invoke('fs:mkdir', rootPath, segments),
  fsRename: (rootPath: string, segments: string[], newName: string) =>
    ipcRenderer.invoke('fs:rename', rootPath, segments, newName),
  fsDelete: (rootPath: string, segments: string[]) => ipcRenderer.invoke('fs:delete', rootPath, segments),
  fsListDrives: () => ipcRenderer.invoke('fs:listDrives'),
  fsStat: (rootPath: string, segments: string[]) => ipcRenderer.invoke('fs:stat', rootPath, segments),
  fsCopy: (rootPath: string, segments: string[], destName: string) =>
    ipcRenderer.invoke('fs:copy', rootPath, segments, destName),
  fsCopyTo: (rootPath: string, srcSegments: string[], destRootPath: string, destSegments: string[]) =>
    ipcRenderer.invoke('fs:copyTo', rootPath, srcSegments, destRootPath, destSegments),
  fsMoveTo: (rootPath: string, srcSegments: string[], destRootPath: string, destSegments: string[]) =>
    ipcRenderer.invoke('fs:moveTo', rootPath, srcSegments, destRootPath, destSegments),
  fsWatch: (rootPath: string) => ipcRenderer.invoke('fs:watch', rootPath),
  fsUnwatch: () => ipcRenderer.invoke('fs:unwatch'),
  onFsChanged: (cb: (payload: { event: string; filename: string; rootPath: string }) => void) => {
    const h = (_e: unknown, payload: { event: string; filename: string; rootPath: string }) => cb(payload)
    ipcRenderer.on('fs:changed', h)
    return () => {
      ipcRenderer.removeListener('fs:changed', h)
    }
  },
  openExeDialog: (): Promise<string | null> => ipcRenderer.invoke('dialog:openExe'),
  setWorkspaceRoots: (roots: string[]) => ipcRenderer.invoke('workspace:setRoots', roots),
  // 真实终端（主进程 node-pty）
  ptySpawn: (opts: unknown) => ipcRenderer.invoke('pty:spawn', opts),
  ptyInput: (ptyId: string, data: string) => ipcRenderer.send('pty:input', ptyId, data),
  ptyResize: (ptyId: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', ptyId, cols, rows),
  ptyDispose: (ptyId: string) => ipcRenderer.send('pty:dispose', ptyId),
  onPtyData: (cb: (ptyId: string, data: string) => void) => {
    const h = (_e: unknown, ptyId: string, data: string) => cb(ptyId, data)
    ipcRenderer.on('pty:data', h)
    return () => {
      ipcRenderer.removeListener('pty:data', h)
    }
  },
  onPtyExit: (cb: (ptyId: string, code: number) => void) => {
    const h = (_e: unknown, ptyId: string, code: number) => cb(ptyId, code)
    ipcRenderer.on('pty:exit', h)
    return () => {
      ipcRenderer.removeListener('pty:exit', h)
    }
  },
  // Git（主进程 git CLI）
  gitStatus: (cwd: string) => ipcRenderer.invoke('git:status', cwd),
  gitDiff: (cwd: string, opts: { staged?: boolean; path?: string }) => ipcRenderer.invoke('git:diff', cwd, opts),
  gitStage: (cwd: string, paths: string[]) => ipcRenderer.invoke('git:stage', cwd, paths),
  gitUnstage: (cwd: string, paths: string[]) => ipcRenderer.invoke('git:unstage', cwd, paths),
  gitCommit: (cwd: string, message: string) => ipcRenderer.invoke('git:commit', cwd, message),
  gitLog: (cwd: string, limit?: number) => ipcRenderer.invoke('git:log', cwd, limit),
  gitBranches: (cwd: string) => ipcRenderer.invoke('git:branches', cwd),
  gitCheckout: (cwd: string, branch: string) => ipcRenderer.invoke('git:checkout', cwd, branch),
  // Skill 库（SKL-001/002/003）
  skillImport: (srcPath: string, scope: 'global' | 'workspace', workspaceId?: string) =>
    ipcRenderer.invoke('skill:import', srcPath, scope, workspaceId),
  skillReadContent: (id: string) => ipcRenderer.invoke('skill:readContent', id),
  skillDelete: (id: string) => ipcRenderer.invoke('skill:delete', id),
  // 工作区搜索（FIL-004）
  searchWorkspace: (rootPath: string, query: string, mode: 'content' | 'filename') =>
    ipcRenderer.invoke('search:workspace', rootPath, query, mode),
  // 磁盘历史会话搜索（HIS-014）
  historySetContext: (input: { commands: Record<string, string>; workspaces: string[] }) =>
    ipcRenderer.invoke('history:setContext', input),
  historySearch: (query: string, tool?: string) => ipcRenderer.invoke('history:search', query, tool),
  historyGroups: (input?: { query?: string; tool?: string; refresh?: boolean }) =>
    ipcRenderer.invoke('history:groups', input),
  historyListGroup: (input: { directoryKey: string; query: string; tool: string; offset: number; limit: number }) =>
    ipcRenderer.invoke('history:listGroup', input),
  historyCheckDirectories: (directories: string[]) => ipcRenderer.invoke('history:checkDirectories', directories),
  historyOpenDirectory: (directory: string) => ipcRenderer.invoke('history:openDirectory', directory),
  historyFindRecent: (input: {
    tool: string
    projectPath: string
    startedAt: number
    excludeSessionId?: string
    sessionId?: string
  }) => ipcRenderer.invoke('history:findRecent', input),
  historyReadSession: (tool: string, sessionId: string) => ipcRenderer.invoke('history:readSession', tool, sessionId),
  historyReadFile: (file: string) => ipcRenderer.invoke('history:readFile', file),
  historyReadSessionPage: (tool: string, sessionId: string, before?: number) =>
    ipcRenderer.invoke('history:readSessionPage', tool, sessionId, before),
  historyReadFilePage: (file: string, before?: number) =>
    ipcRenderer.invoke('history:readFilePage', file, before),
  updateRuntime: () => ipcRenderer.invoke('update:runtime'),
  checkAppUpdate: (force?: boolean) => ipcRenderer.invoke('update:check', force === true),
  openUpdateUrl: (url: string) => ipcRenderer.invoke('update:open', url),
}

contextBridge.exposeInMainWorld('ringcode', api)

export type RingCodeApi = typeof api
