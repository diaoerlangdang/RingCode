import * as fs from 'node:fs'
import * as os from 'node:os'
import { ipcMain, shell } from 'electron'
import { deleteCredential } from './cred'
import { writeCloneSnapshot, type CloneSnapshot } from './cloneSnapshot'
import { binDir, launcherOwnedBy, launcherStatus, writeAppLaunchPointer, writeCloneLauncher, type AppLaunchPointer } from './cloneLauncherFile'
import { overlayOwnedBy } from './codexOverlayWrite'
import { listOwnedResources, removeOwnedResources, type OwnedResource } from './ownedResources'
import { hasRunningPty, listRunningCloneIds } from './pty'
import { ownedResourcesPath, LAUNCHER_MARKER } from './ringcodeHome'

export interface CleanupItemResult {
  kind: OwnedResource['kind'] | 'credential'
  target: string
  ok: boolean
  missing?: boolean
  reason?: string
}

const BUILTIN_CREDENTIAL_REFS = ['ringcode:anthropic-key', 'ringcode:openai-key']

function deleteOwnedPath(file: string, cloneId: string, kind: OwnedResource['kind']): CleanupItemResult {
  if (!fs.existsSync(file)) return { kind, target: file, ok: true, missing: true }
  try {
    const content = fs.readFileSync(file, 'utf8')
    const owned =
      kind === 'codexOverlay'
        ? overlayOwnedBy(content, cloneId)
        : kind === 'launcher'
          ? launcherOwnedBy(content, cloneId)
          : kind === 'snapshot'
            ? content.includes(`"cloneId": "${cloneId}"`) || content.includes(`"cloneId":"${cloneId}"`)
            : content.includes(LAUNCHER_MARKER)
    if (!owned) return { kind, target: file, ok: false, reason: '文件不属于本应用，已跳过' }
    fs.unlinkSync(file)
    return { kind, target: file, ok: true }
  } catch (err) {
    return { kind, target: file, ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

function deleteCred(ref: string): CleanupItemResult {
  try {
    const existed = deleteCredential(ref)
    return { kind: 'credential', target: ref, ok: true, missing: !existed }
  } catch (err) {
    return { kind: 'credential', target: ref, ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

export function cleanupCloneResources(cloneId: string, home = os.homedir()): CleanupItemResult[] {
  const results: CleanupItemResult[] = []
  const registry = ownedResourcesPath(home)
  const items = listOwnedResources(registry).filter((item) => item.cloneId === cloneId)
  for (const item of items) {
    if (item.kind === 'credential') results.push(deleteCred(item.id))
    else results.push(deleteOwnedPath(item.path, cloneId, item.kind))
  }
  const failed = new Set(results.filter((item) => !item.ok).map((item) => item.target))
  removeOwnedResources((item) => {
    if (item.cloneId !== cloneId) return false
    if (item.kind === 'credential') return !failed.has(item.id)
    return !failed.has(item.path)
  }, registry)
  return results
}

export function clearKeyResource(cloneId: string, home = os.homedir()): CleanupItemResult[] {
  const results: CleanupItemResult[] = []
  for (const item of listOwnedResources(ownedResourcesPath(home))) {
    if (item.cloneId === cloneId && item.kind === 'credential') results.push(deleteCred(item.id))
  }
  return results
}

export function clearAllOwnedResources(home = os.homedir()): CleanupItemResult[] {
  const results: CleanupItemResult[] = []
  const registry = ownedResourcesPath(home)
  const seenCred = new Set<string>()
  for (const item of listOwnedResources(registry)) {
    if (item.kind === 'credential') {
      seenCred.add(item.id)
      results.push(deleteCred(item.id))
    } else {
      results.push(deleteOwnedPath(item.path, item.cloneId, item.kind))
    }
  }
  for (const ref of BUILTIN_CREDENTIAL_REFS) {
    if (!seenCred.has(ref)) results.push(deleteCred(ref))
  }
  const failed = new Set(results.filter((item) => !item.ok).map((item) => item.target))
  removeOwnedResources((item) => {
    if (item.kind === 'credential') return !failed.has(item.id)
    return !failed.has(item.path)
  }, registry)
  return results
}

export function registerCloneResourceHandlers(getPointer: () => AppLaunchPointer | null): void {
  ipcMain.handle('clone:sync', (_e, input: { snapshot: CloneSnapshot }) => {
    if (!input?.snapshot) return { snapshot: { ok: false, reason: 'invalid snapshot' }, launcher: { ok: false, reason: 'invalid snapshot' } }
    const pointer = getPointer()
    const appLaunch = pointer ? writeAppLaunchPointer(pointer) : { ok: false as const, reason: '应用路径未知' }
    const snapshot = writeCloneSnapshot(input.snapshot)
    const launcher = writeCloneLauncher({ cloneId: input.snapshot.cloneId, commandName: input.snapshot.commandName })
    return { snapshot, launcher, appLaunch }
  })
  ipcMain.handle('clone:launcherStatus', (_e, input: { cloneId: string; commandName: string }) => {
    if (!input?.cloneId || !input.commandName) return { ok: false, path: '', reason: 'invalid' }
    return launcherStatus(input)
  })
  ipcMain.handle('clone:openBin', async () => {
    await shell.openPath(binDir())
    return true
  })
  ipcMain.handle('clone:delete', (_e, cloneId: string) => {
    if (typeof cloneId !== 'string' || !cloneId) return { ok: false, results: [], reason: 'invalid cloneId' }
    if (listRunningCloneIds().includes(cloneId)) {
      return { ok: false, results: [], reason: 'running' }
    }
    const results = cleanupCloneResources(cloneId)
    return { ok: results.every((item) => item.ok), results }
  })
  ipcMain.handle('clone:clearKey', (_e, cloneId: string) => {
    if (typeof cloneId !== 'string' || !cloneId) return { ok: false, results: [], reason: 'invalid cloneId' }
    if (listRunningCloneIds().includes(cloneId)) {
      return { ok: false, results: [], reason: 'running' }
    }
    const results = clearKeyResource(cloneId)
    return { ok: results.every((item) => item.ok), results }
  })
  ipcMain.handle('clone:clearAll', () => {
    if (hasRunningPty()) return { ok: false, results: [], reason: 'running' }
    const results = clearAllOwnedResources()
    return { ok: results.every((item) => item.ok), results }
  })
  ipcMain.handle('clone:running', (_e, cloneId?: string) => {
    if (typeof cloneId === 'string' && cloneId) return listRunningCloneIds().includes(cloneId)
    return hasRunningPty()
  })
}
