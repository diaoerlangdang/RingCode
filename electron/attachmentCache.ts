import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'

const managedName = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg)$/
export const IMAGE_GRACE_MS = 24 * 60 * 60 * 1000
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export function imageExtension(bytes: Uint8Array): string {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('每张图片最大 10 MB，且不能为空')
  const b = Buffer.from(bytes)
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png'
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'jpg'
  throw new Error('本版支持 PNG、JPEG 图片，请先转换其他格式')
}

/** Resolve references from the authoritative persisted snapshot, never an empty UI before hydration. */
export function imageReferences(raw: string | null): Set<string> {
  if (raw === null) return new Set()
  const state = JSON.parse(raw).state
  if (!state || !Array.isArray(state.sessions) || !Array.isArray(state.terminals)) throw new Error('本地数据未能读取，已暂停缓存清理')
  const refs = new Set<string>()
  for (const session of state.sessions) for (const id of session.imageIds ?? []) refs.add(id)
  for (const draft of Object.values(state.terminalDrafts ?? {}) as { images?: { id: string }[] }[]) {
    for (const image of draft.images ?? []) refs.add(image.id)
  }
  return refs
}

export class AttachmentCache {
  constructor(readonly root: string) {}

  private ensureRoot(): void {
    fs.mkdirSync(this.root, { recursive: true })
    if (fs.lstatSync(this.root).isSymbolicLink()) throw new Error('附件目录不能是链接')
  }

  private file(id: string): string {
    if (!managedName.test(id)) throw new Error('无效图片标识')
    const file = path.resolve(this.root, id)
    if (path.dirname(file) !== path.resolve(this.root)) throw new Error('无效图片路径')
    return file
  }

  add(name: string, bytes: Uint8Array) {
    this.ensureRoot()
    const id = `${randomUUID()}.${imageExtension(bytes)}`
    const file = this.file(id)
    fs.writeFileSync(file, bytes, { flag: 'wx' })
    return { id, name: path.basename(name).slice(0, 120) || '截图.png', path: file, size: bytes.byteLength }
  }

  read(id: string): { path: string; bytes: Buffer } {
    this.ensureRoot()
    const file = this.file(id)
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_IMAGE_BYTES) throw new Error('图片文件不可用')
    return { path: file, bytes: fs.readFileSync(file) }
  }

  stats(refs: Set<string>) {
    this.ensureRoot()
    let bytes = 0, unusedBytes = 0, count = 0
    for (const id of fs.readdirSync(this.root).filter((id) => managedName.test(id))) {
      const stat = fs.lstatSync(this.file(id))
      if (!stat.isFile() || stat.isSymbolicLink()) continue
      bytes += stat.size
      count++
      if (!refs.has(id)) unusedBytes += stat.size
    }
    return { bytes, unusedBytes, count }
  }

  clean(refs: Set<string>, immediateIds?: string[], now = Date.now()) {
    this.ensureRoot()
    const pendingFile = path.join(this.root, 'pending-delete.json')
    const hadPendingFile = fs.existsSync(pendingFile)
    let pending = new Set<string>()
    if (hadPendingFile) {
      if (fs.lstatSync(pendingFile).isSymbolicLink()) throw new Error('待清理记录不能是链接')
      const saved: unknown = JSON.parse(fs.readFileSync(pendingFile, 'utf8'))
      if (!Array.isArray(saved) || saved.some((id) => typeof id !== 'string' || !managedName.test(id))) throw new Error('待清理记录无法读取')
      pending = new Set(saved)
    }
    const requested = immediateIds && new Set(immediateIds)
    let deleted = 0, failed = 0
    const candidates = fs.readdirSync(this.root).filter((id) => managedName.test(id))
    pending = new Set([...pending].filter((id) => candidates.includes(id) && !refs.has(id)))
    for (const id of candidates) {
      if (refs.has(id) || (requested && !requested.has(id))) continue
      try {
        const file = this.file(id)
        const stat = fs.lstatSync(file)
        if (!stat.isFile() || stat.isSymbolicLink()) continue
        if (!requested && !pending.has(id) && now - stat.mtimeMs < IMAGE_GRACE_MS) continue
        fs.unlinkSync(file)
        pending.delete(id)
        deleted++
      } catch { failed++; pending.add(id) }
    }
    if (pending.size) {
      const temporary = path.join(this.root, `.pending-delete-${randomUUID()}.tmp`)
      fs.writeFileSync(temporary, JSON.stringify([...pending]), { flag: 'wx' })
      fs.renameSync(temporary, pendingFile)
    } else if (hadPendingFile) {
      fs.unlinkSync(pendingFile)
    }
    return { deleted, failed }
  }
}
