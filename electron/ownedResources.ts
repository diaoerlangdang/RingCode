import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ipcMain } from 'electron'
import { ownedResourcesPath } from './ringcodeHome'

export type OwnedResource =
  | { kind: 'credential'; id: string; cloneId: string }
  | { kind: 'codexOverlay'; path: string; cloneId: string; profileName: string }
  | { kind: 'launcher'; path: string; cloneId: string; commandName: string }
  | { kind: 'snapshot'; path: string; cloneId: string }

interface OwnedResourceFile {
  version: 1
  items: OwnedResource[]
}

function registryPath(home = os.homedir()): string {
  return ownedResourcesPath(home)
}

function readRegistry(file = registryPath()): OwnedResourceFile {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const data = JSON.parse(raw) as OwnedResourceFile
    if (data?.version === 1 && Array.isArray(data.items)) return data
  } catch {
    /* missing or invalid */
  }
  return { version: 1, items: [] }
}

function writeRegistry(data: OwnedResourceFile, file = registryPath()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

function sameResource(a: OwnedResource, b: OwnedResource): boolean {
  if (a.kind !== b.kind || a.cloneId !== b.cloneId) return false
  if (a.kind === 'credential' && b.kind === 'credential') return a.id === b.id
  if (a.kind === 'codexOverlay' && b.kind === 'codexOverlay') return a.path === b.path
  if (a.kind === 'launcher' && b.kind === 'launcher') return a.path === b.path
  if (a.kind === 'snapshot' && b.kind === 'snapshot') return a.path === b.path
  return false
}

export function registerOwnedResource(item: OwnedResource, file = registryPath()): void {
  const data = readRegistry(file)
  if (!data.items.some((existing) => sameResource(existing, item))) data.items.push(item)
  writeRegistry(data, file)
}

export function listOwnedResources(file = registryPath()): OwnedResource[] {
  return readRegistry(file).items
}

export function removeOwnedResources(
  predicate: (item: OwnedResource) => boolean,
  file = registryPath(),
): OwnedResource[] {
  const data = readRegistry(file)
  const removed = data.items.filter(predicate)
  data.items = data.items.filter((item) => !predicate(item))
  writeRegistry(data, file)
  return removed
}

function isOwnedResourcePayload(item: unknown): item is OwnedResource {
  if (!item || typeof item !== 'object') return false
  const value = item as OwnedResource
  if (typeof value.cloneId !== 'string' || typeof value.kind !== 'string') return false
  if (value.kind === 'credential') return typeof value.id === 'string'
  if (value.kind === 'codexOverlay') return typeof value.path === 'string' && typeof value.profileName === 'string'
  if (value.kind === 'launcher') return typeof value.path === 'string' && typeof value.commandName === 'string'
  if (value.kind === 'snapshot') return typeof value.path === 'string'
  return false
}

export function registerOwnedResourceHandlers(): void {
  ipcMain.handle('resources:register', (_e, item: unknown) => {
    if (!isOwnedResourcePayload(item)) return false
    registerOwnedResource(item)
    return true
  })
  ipcMain.handle('resources:list', () => listOwnedResources())
}
