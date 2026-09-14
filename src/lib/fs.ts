// 文件系统访问层：
//  - Electron：主进程 Node fs（真实磁盘，支持读/写/增删改，§9.3 路径校验）—— 主路径
//  - Web：File System Access API（真实目录，读 + 写）
//  - 兜底 mock：无上述能力时的演示树
import type { FsEntry } from '@/types'
import type { RingCodeApi } from '@/types/electron'

export type DirHandle =
  | { kind: 'real'; handle: FileSystemDirectoryHandle; name: string }
  | { kind: 'electron'; rootPath: string; name: string }
  | { kind: 'mock' }

type FSDirHandle = FileSystemDirectoryHandle

function api(): RingCodeApi | undefined {
  return typeof window !== 'undefined' ? window.ringcode : undefined
}

/** 仅在 Electron 环境可用 */
function el(): RingCodeApi {
  const a = api()
  if (!a?.isElectron) throw new Error('当前环境不支持原生文件操作')
  return a
}

export function isFsAccessSupported(): boolean {
  return !!api()?.isElectron || typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
}

/** 弹出系统文件夹选择器（需用户手势触发） */
export async function pickDirectory(): Promise<DirHandle | null> {
  const a = api()
  if (a?.isElectron) {
    const p = await a.openDirectoryDialog()
    if (!p) return null
    const name = p.split(/[\\/]/).filter(Boolean).pop() ?? p
    return { kind: 'electron', rootPath: p, name }
  }
  const w = window as unknown as { showDirectoryPicker?: (opts?: unknown) => Promise<FSDirHandle> }
  if (!w.showDirectoryPicker) return null
  try {
    const handle = await w.showDirectoryPicker({ mode: 'readwrite' })
    return { kind: 'real', handle, name: handle.name }
  } catch {
    return null
  }
}

/* ---------------- mock 文件系统（web 兜底演示） ---------------- */

type MockNode =
  | { type: 'dir'; children: Record<string, MockNode> }
  | { type: 'file'; size: number; content?: string }

const mockTree: MockNode = {
  type: 'dir',
  children: {
    components: {
      type: 'dir',
      children: {
        'Button.tsx': { type: 'file', size: 1240, content: "import React from 'react'\n\nexport function Button({ children }: { children: React.ReactNode }) {\n  return <button className=\"btn\">{children}</button>\n}\n" },
        'Modal.tsx': { type: 'file', size: 980 },
      },
    },
    utils: {
      type: 'dir',
      children: {
        'path.ts': { type: 'file', size: 540 },
      },
    },
    hooks: {
      type: 'dir',
      children: {
        'useTheme.ts': { type: 'file', size: 720 },
      },
    },
    'app.tsx': {
      type: 'file',
      size: 2100,
      content: "import { TopBar } from './components/TopBar'\n\nexport default function App() {\n  return (\n    <div className=\"app\">\n      <TopBar />\n    </div>\n  )\n}\n",
    },
    'main.tsx': { type: 'file', size: 320, content: "import { createRoot } from 'react-dom/client'\nimport App from './App'\ncreateRoot(document.getElementById('root')!).render(<App />)\n" },
    'index.css': { type: 'file', size: 880 },
    'vite.config.ts': { type: 'file', size: 410 },
    'types.d.ts': { type: 'file', size: 260 },
    'README.md': {
      type: 'file',
      size: 1500,
      content: `# 金刚琢\n\n> 以本地工作区为中心的 Windows 原生 AI 工作台。\n\n## 特性\n\n- 统一工作区、文件、终端与 AI 会话\n- 一键启动 Claude Code / Codex\n- 历史会话搜索与恢复\n- 本地 Skill 库管理\n\n## 快捷键\n\n| 功能 | 快捷键 |\n| --- | --- |\n| 命令面板 | \`Ctrl+Shift+P\` |\n| 启动 Claude Code | \`Ctrl+Shift+1\` |\n| 切换主题 | \`Ctrl+K Ctrl+T\` |\n\n> 金刚琢寓意包罗万象、吸收并驾驭优秀工具。\n`,
    },
  },
}

function mockNode(segments: string[]): MockNode | null {
  let node: MockNode = mockTree
  for (const seg of segments) {
    if (node.type !== 'dir' || !node.children[seg]) return null
    node = node.children[seg]
  }
  return node
}

function mockList(segments: string[]): FsEntry[] {
  const node = mockNode(segments)
  if (!node || node.type !== 'dir') return []
  return Object.entries(node.children).map(([name, n]) => ({
    name,
    isDir: n.type === 'dir',
    size: n.type === 'file' ? n.size : undefined,
  })).sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
}

async function realList(handle: FSDirHandle, segments: string[]): Promise<FsEntry[]> {
  let dir = handle
  for (const seg of segments) {
    dir = await dir.getDirectoryHandle(seg)
  }
  const out: FsEntry[] = []
  for await (const [name, child] of (dir as unknown as { entries: () => AsyncIterableIterator<[string, { kind: string }]> }).entries()) {
    out.push({ name, isDir: child.kind === 'directory' })
  }
  return out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
}

/** 列出目录（handle + 根下相对路径 segments） */
export async function listDir(handle: DirHandle, segments: string[]): Promise<FsEntry[]> {
  if (handle.kind === 'electron') {
    if (!handle.rootPath) return []
    return el().fsList(handle.rootPath, segments)
  }
  if (handle.kind === 'mock') return mockList(segments)
  return realList(handle.handle, segments)
}

/** 读取文本文件内容（编辑器/预览用） */
export async function readTextFile(handle: DirHandle, segments: string[]): Promise<string | null> {
  if (handle.kind === 'electron') {
    if (!handle.rootPath) return null
    try {
      return await el().fsReadText(handle.rootPath, segments)
    } catch {
      return null
    }
  }
  if (handle.kind === 'mock') {
    const node = mockNode(segments)
    if (node && node.type === 'file') return node.content ?? `// ${segments[segments.length - 1]}\n// （演示文件：未提供内容）\n`
    return null
  }
  let dir = handle.handle
  for (let i = 0; i < segments.length - 1; i++) dir = await dir.getDirectoryHandle(segments[i])
  const fileHandle = await dir.getFileHandle(segments[segments.length - 1])
  const file = await fileHandle.getFile()
  return file.text()
}

/** 写入文本文件（编辑器保存 / 新建文件） */
export async function writeTextFile(handle: DirHandle, segments: string[], content: string): Promise<void> {
  if (handle.kind === 'electron') {
    if (!handle.rootPath) throw new Error('未打开工作区')
    return el().fsWriteText(handle.rootPath, segments, content)
  }
  if (handle.kind === 'real') {
    let dir = handle.handle
    for (let i = 0; i < segments.length - 1; i++) dir = await dir.getDirectoryHandle(segments[i])
    const fh = await dir.getFileHandle(segments[segments.length - 1], { create: true })
    const w = await fh.createWritable()
    await w.write(content)
    await w.close()
    return
  }
  // mock：在内存树里建/改文件
  const parent = mockNode(segments.slice(0, -1))
  if (parent && parent.type === 'dir') {
    parent.children[segments[segments.length - 1]] = { type: 'file', size: content.length, content }
  }
}

/** 新建文件夹 */
export async function createDirectory(handle: DirHandle, segments: string[]): Promise<void> {
  if (handle.kind === 'electron') {
    if (!handle.rootPath) throw new Error('未打开工作区')
    return el().fsMkdir(handle.rootPath, segments)
  }
  if (handle.kind === 'real') {
    let dir = handle.handle
    for (const seg of segments) dir = await dir.getDirectoryHandle(seg, { create: true })
    return
  }
  const parent = mockNode(segments.slice(0, -1))
  if (parent && parent.type === 'dir') {
    parent.children[segments[segments.length - 1]] = { type: 'dir', children: {} }
  }
}

/** 重命名（同目录内改名） */
export async function renameEntry(handle: DirHandle, segments: string[], newName: string): Promise<void> {
  if (handle.kind === 'electron') {
    if (!handle.rootPath) throw new Error('未打开工作区')
    return el().fsRename(handle.rootPath, segments, newName)
  }
  throw new Error('当前环境不支持重命名')
}

/** 删除文件或文件夹（递归） */
export async function deleteEntry(handle: DirHandle, segments: string[]): Promise<void> {
  if (handle.kind === 'electron') {
    if (!handle.rootPath) throw new Error('未打开工作区')
    return el().fsDelete(handle.rootPath, segments)
  }
  if (handle.kind === 'real') {
    let dir = handle.handle
    for (let i = 0; i < segments.length - 1; i++) dir = await dir.getDirectoryHandle(segments[i])
    await dir.removeEntry(segments[segments.length - 1], { recursive: true })
    return
  }
  throw new Error('当前环境不支持删除')
}

export async function copyEntry(handle: DirHandle, segments: string[], destName: string): Promise<void> {
  if (handle.kind === 'electron') {
    if (!handle.rootPath) throw new Error('未打开工作区')
    return el().fsCopy(handle.rootPath, segments, destName)
  }
  throw new Error('当前环境不支持复制')
}

/** 复制文件/文件夹（递归）到任意目标目录（destSegments 为完整目标路径，含名称）。仅 Electron。 */
export async function copyEntryTo(
  srcHandle: DirHandle,
  srcSegments: string[],
  destHandle: DirHandle,
  destSegments: string[],
): Promise<void> {
  if (srcHandle.kind !== 'electron' || destHandle.kind !== 'electron' || !srcHandle.rootPath || !destHandle.rootPath) {
    throw new Error('当前环境不支持复制')
  }
  return el().fsCopyTo(srcHandle.rootPath, srcSegments, destHandle.rootPath, destSegments)
}

/** 移动（剪切粘贴）文件/文件夹到任意目标目录。仅 Electron。 */
export async function moveEntryTo(
  srcHandle: DirHandle,
  srcSegments: string[],
  destHandle: DirHandle,
  destSegments: string[],
): Promise<void> {
  if (srcHandle.kind !== 'electron' || destHandle.kind !== 'electron' || !srcHandle.rootPath || !destHandle.rootPath) {
    throw new Error('当前环境不支持移动')
  }
  return el().fsMoveTo(srcHandle.rootPath, srcSegments, destHandle.rootPath, destSegments)
}

export async function statEntry(
  handle: DirHandle,
  segments: string[],
): Promise<{ mtime: number; size: number; isDir: boolean } | null> {
  if (handle.kind === 'electron') {
    if (!handle.rootPath) throw new Error('未打开工作区')
    return el().fsStat(handle.rootPath, segments)
  }
  return null
}

/** 用资源管理器打开（真实环境由 Electron shell.openPath 提供） */
export function revealInExplorer(_path: string): void {
  // web 环境无对应能力；Electron 期通过 IPC 调 shell.openPath
}
