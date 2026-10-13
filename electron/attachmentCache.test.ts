import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync, rmSync, symlinkSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { AttachmentCache, IMAGE_GRACE_MS, imageReferences } from './attachmentCache'

const failure = vi.hoisted(() => ({ once: false }))
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return { ...fs, unlinkSync: (file: string) => {
    if (failure.once) { failure.once = false; throw new Error('locked') }
    fs.unlinkSync(file)
  } }
})

const roots: string[] = []
const fixture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64')
function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'ringcode-images-'))
  roots.push(root)
  return { root, cache: new AttachmentCache(path.join(root, 'attachments')) }
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (path.dirname(path.resolve(root)) === path.resolve(tmpdir()) && path.basename(root).startsWith('ringcode-images-')) rmSync(root, { recursive: true, force: true })
  }
})
describe('managed image copies', () => {
  it('uses generated identities and preserves original files, including Chinese names and spaces', () => {
    const { root, cache } = setup()
    const original = path.join(root, '原图 空格.png')
    writeFileSync(original, fixture)
    const image = cache.add('原图 空格.png', fixture)
    expect(image.path).not.toBe(original)
    expect(cache.read(image.id).bytes).toEqual(fixture)
    expect(() => cache.read('../原图 空格.png')).toThrow()
    expect(() => cache.add('evil.svg', Buffer.from('<svg/>'))).toThrow()
    cache.clean(new Set(), [image.id])
    expect(existsSync(original)).toBe(true)
    expect(existsSync(image.path)).toBe(false)
  })
  it('protects both session and draft references, including shared images, across reload', () => {
    const { cache } = setup()
    const image = cache.add('截图.png', fixture)
    const state = { sessions: [{ id: 's1', imageIds: [image.id] }, { id: 's2', imageIds: [image.id] }], terminals: [], terminalDrafts: { t: { images: [{ id: image.id }] } } }
    const refs = () => imageReferences(JSON.stringify({ state }))
    expect(cache.clean(refs(), [image.id]).deleted).toBe(0)
    state.sessions.shift()
    expect(cache.clean(refs(), [image.id]).deleted).toBe(0)
    state.sessions = []
    expect(cache.clean(refs(), [image.id]).deleted).toBe(0)
    state.terminalDrafts.t.images = []
    expect(cache.clean(refs(), [image.id]).deleted).toBe(1)
  })
  it('waits 24 hours for crash leftovers and skips malformed snapshots and links', () => {
    const { root, cache } = setup()
    const image = cache.add('截图.png', fixture)
    expect(cache.clean(new Set()).deleted).toBe(0)
    expect(cache.clean(new Set(), undefined, Date.now() + IMAGE_GRACE_MS + 10).deleted).toBe(1)
    expect(() => imageReferences('{broken')).toThrow()
    expect(() => imageReferences('{}')).toThrow()
    const source = path.join(root, 'original.png')
    writeFileSync(source, fixture)
    const linkId = '12345678-1234-4123-8123-123456789abc.png'
    symlinkSync(source, path.join(cache.root, linkId))
    expect(() => cache.read(linkId)).toThrow()
    expect(cache.clean(new Set(), [linkId]).deleted).toBe(0)
    expect(existsSync(source)).toBe(true)
  })
  it('reports occupied and unreferenced space and retries a retained candidate', () => {
    const { cache } = setup()
    const a = cache.add('a.png', fixture), b = cache.add('b.png', fixture)
    expect(cache.stats(new Set([a.id]))).toEqual({ count: 2, bytes: fixture.length * 2, unusedBytes: fixture.length })
    utimesSync(b.path, new Date(0), new Date(0))
    expect(cache.clean(new Set([a.id])).deleted).toBe(1)
    expect(cache.stats(new Set([a.id])).count).toBe(1)
  })
  it('keeps failed deletions on disk and retries them after restart', () => {
    const { cache } = setup()
    const image = cache.add('截图.png', fixture)
    failure.once = true
    expect(cache.clean(new Set(), [image.id])).toEqual({ deleted: 0, failed: 1 })
    expect(existsSync(image.path)).toBe(true)
    expect(new AttachmentCache(cache.root).clean(new Set())).toEqual({ deleted: 1, failed: 0 })
  })
})
