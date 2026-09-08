import type { DirHandle } from './fs'

export interface FsChangePayload {
  event: string
  filename: string
  rootPath: string
}

interface OpenFileIdentity {
  handle: DirHandle
  segments: string[]
}

interface SyncOpenFile extends OpenFileIdentity {
  id: string
  name: string
  dirty: boolean
  conflict?: boolean
}

interface SyncActions {
  getCurrent?: (id: string) => SyncOpenFile | undefined
  reload: (id: string) => Promise<boolean>
  markConflict: (id: string) => void
  notifyConflict: (name: string) => void
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase()
}

/** 判断主进程的 fs.watch 事件是否属于某个已打开文件。filename 为空时表示根目录需整体复核。 */
export function fileMatchesFsChange(file: OpenFileIdentity, change: FsChangePayload): boolean {
  if (file.handle.kind !== 'electron') return false
  if (normalizePath(file.handle.rootPath) !== normalizePath(change.rootPath)) return false
  if (!change.filename) return true
  return normalizePath(file.segments.join('/')) === normalizePath(change.filename)
}

export async function syncChangedOpenFiles(
  files: SyncOpenFile[],
  changes: FsChangePayload[],
  actions: SyncActions,
): Promise<void> {
  for (const file of files) {
    if (!changes.some((change) => fileMatchesFsChange(file, change))) continue
    const current = actions.getCurrent?.(file.id) ?? file
    if (current.dirty) {
      if (!current.conflict) {
        actions.markConflict(current.id)
        actions.notifyConflict(current.name)
      }
      continue
    }
    await actions.reload(current.id)
  }
}
