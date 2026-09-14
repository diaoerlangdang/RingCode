import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { cloneSnapshotPath, ringcodeClonesDir } from './ringcodeHome'
import { registerOwnedResource } from './ownedResources'

export interface CloneSnapshot {
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

export function writeCloneSnapshot(snapshot: CloneSnapshot, home = os.homedir()): { ok: true; path: string } | { ok: false; reason: string } {
  if (!snapshot.cloneId || !snapshot.commandName || !snapshot.credentialRef) {
    return { ok: false, reason: '分身快照缺少身份字段' }
  }
  if (snapshot.family !== 'claude' && snapshot.family !== 'codex') {
    return { ok: false, reason: '不支持的分身家族' }
  }
  const file = cloneSnapshotPath(snapshot.cloneId, home)
  try {
    fs.mkdirSync(ringcodeClonesDir(home), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify({ ...snapshot, version: 1, updatedAt: Date.now() }, null, 2)}\n`)
    fs.renameSync(tmp, file)
    registerOwnedResource({ kind: 'snapshot', path: file, cloneId: snapshot.cloneId }, path.join(home, '.ringcode', 'owned-resources.json'))
    return { ok: true, path: file }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

export function readCloneSnapshot(cloneId: string, home = os.homedir()): CloneSnapshot | { ok: false; reason: string } {
  const file = cloneSnapshotPath(cloneId, home)
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const data = JSON.parse(raw) as CloneSnapshot
    if (!data || data.version !== 1 || data.cloneId !== cloneId) {
      return { ok: false, reason: '分身配置无效或已不是原身份' }
    }
    return data
  } catch {
    return { ok: false, reason: '未找到分身配置。若已清本地数据，请在应用内打开该分身并补全配置。' }
  }
}
