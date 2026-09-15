import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ipcMain } from 'electron'
import { registerOwnedResource } from './ownedResources'

const MARKER = 'Owned by RingCode.'

export interface WriteOverlayInput {
  cloneId: string
  profileName: string
  content: string
}

export type WriteOverlayResult = { ok: true; path: string } | { ok: false; reason: string }

function overlayPath(profileName: string, home = os.homedir()): string {
  return path.join(home, '.codex', `${profileName}.config.toml`)
}

export function overlayOwnedBy(content: string, cloneId: string): boolean {
  return content.includes(`${MARKER} cloneId=${cloneId}`)
}

export function writeCodexOverlay(input: WriteOverlayInput, home = os.homedir()): WriteOverlayResult {
  const profileName = input.profileName.trim()
  if (!input.cloneId || !profileName || !/^ringcode-[a-zA-Z0-9-]+$/.test(profileName)) {
    return { ok: false, reason: 'overlay 文件名无效' }
  }
  if (!overlayOwnedBy(input.content, input.cloneId)) {
    return { ok: false, reason: 'overlay 缺少 RingCode 归属标记' }
  }
  const file = overlayPath(profileName, home)
  try {
    if (fs.existsSync(file)) {
      const existing = fs.readFileSync(file, 'utf8')
      if (existing.trim() && !overlayOwnedBy(existing, input.cloneId)) {
        return { ok: false, reason: `已存在非本应用文件：${file}` }
      }
    }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, input.content.endsWith('\n') ? input.content : `${input.content}\n`, 'utf8')
    fs.renameSync(tmp, file)
    registerOwnedResource(
      { kind: 'codexOverlay', path: file, cloneId: input.cloneId, profileName },
      path.join(home, '.ringcode', 'owned-resources.json'),
    )
    return { ok: true, path: file }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

export function registerCodexOverlayHandlers(): void {
  ipcMain.handle('codex:writeOverlay', (_e, input: WriteOverlayInput): WriteOverlayResult => {
    if (!input || typeof input !== 'object') return { ok: false, reason: 'invalid overlay' }
    return writeCodexOverlay(input)
  })
}
