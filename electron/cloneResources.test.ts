import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const deleted: string[] = []

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openPath: vi.fn() },
}))
vi.mock('./pty', () => ({
  hasRunningPty: vi.fn(() => false),
  listRunningCloneIds: vi.fn(() => []),
}))
vi.mock('./cred', () => ({
  deleteCredential: vi.fn((ref: string) => {
    deleted.push(ref)
    return true
  }),
}))

const { cleanupCloneResources, clearAllOwnedResources, clearKeyResource } = await import('./cloneResources')
const { writeCloneLauncher } = await import('./cloneLauncherFile')
const { writeCloneSnapshot } = await import('./cloneSnapshot')
const { listOwnedResources, registerOwnedResource } = await import('./ownedResources')
const { LAUNCHER_MARKER } = await import('./ringcodeHome')

describe('clone resource cleanup', () => {
  it('removes owned launcher/snapshot files', () => {
    deleted.length = 0
    const home = mkdtempSync(path.join(tmpdir(), 'ringcode-cleanup-'))
    writeCloneSnapshot(
      {
        version: 1,
        cloneId: 'clone-a',
        commandName: 'cheap-claude',
        name: 'A',
        family: 'claude',
        command: 'claude',
        model: '',
        modelMode: 'default',
        baseUrl: '',
        credentialRef: 'ringcode:clone:clone-a',
        updatedAt: 1,
      },
      home,
    )
    const launcher = writeCloneLauncher({ cloneId: 'clone-a', commandName: 'cheap-claude' }, home)
    expect(launcher.ok).toBe(true)
    const results = cleanupCloneResources('clone-a', home)
    expect(results.every((item) => item.ok)).toBe(true)
    expect(listOwnedResources(path.join(home, '.ringcode', 'owned-resources.json')).some((item) => item.cloneId === 'clone-a')).toBe(false)
  })

  it('skips foreign files and keeps them on disk', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ringcode-foreign-'))
    const file = path.join(home, '.ringcode', 'bin', 'taken.cmd')
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '@echo off\necho not-ours\n')
    const registry = path.join(home, '.ringcode', 'owned-resources.json')
    registerOwnedResource({ kind: 'launcher', path: file, cloneId: 'clone-x', commandName: 'taken' }, registry)
    const results = cleanupCloneResources('clone-x', home)
    expect(results.some((item) => item.kind === 'launcher' && item.ok === false && /不属于/.test(item.reason ?? ''))).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('not-ours')
  })

  it('still finds leftover owned files from the registry after local app data is gone', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ringcode-leftover-'))
    const launcher = writeCloneLauncher({ cloneId: 'clone-z', commandName: 'left-over' }, home)
    expect(launcher.ok).toBe(true)
    if (!launcher.ok) return
    const registry = path.join(home, '.ringcode', 'owned-resources.json')
    expect(listOwnedResources(registry).some((item) => item.cloneId === 'clone-z')).toBe(true)
    const results = cleanupCloneResources('clone-z', home)
    expect(results.some((item) => item.kind === 'launcher' && item.ok)).toBe(true)
    expect(listOwnedResources(registry).some((item) => item.cloneId === 'clone-z')).toBe(false)
  })

  it('clear-all deletes owned files and builtin credential refs', () => {
    deleted.length = 0
    const home = mkdtempSync(path.join(tmpdir(), 'ringcode-clearall-'))
    mkdirSync(path.join(home, '.ringcode'), { recursive: true })
    const overlay = path.join(home, '.codex', 'ringcode-clone-a.config.toml')
    const catalog = path.join(home, '.codex', 'ringcode-clone-a.models.json')
    mkdirSync(path.dirname(overlay), { recursive: true })
    writeFileSync(overlay, `# ${LAUNCHER_MARKER} cloneId=clone-a\n`)
    writeFileSync(catalog, '{"models":[{"description":"RingCode isolated model catalog for clone-a"}]}')
    writeFileSync(
      path.join(home, '.ringcode', 'owned-resources.json'),
      JSON.stringify({
        version: 1,
        items: [
          { kind: 'credential', id: 'ringcode:clone:clone-a', cloneId: 'clone-a' },
          { kind: 'codexOverlay', path: overlay, cloneId: 'clone-a', profileName: 'ringcode-clone-a' },
          { kind: 'codexCatalog', path: catalog, cloneId: 'clone-a', profileName: 'ringcode-clone-a' },
        ],
      }),
    )
    const results = clearAllOwnedResources(home)
    expect(results.every((item) => item.ok)).toBe(true)
    expect(deleted).toEqual(expect.arrayContaining(['ringcode:clone:clone-a', 'ringcode:anthropic-key', 'ringcode:openai-key']))
    expect(() => readFileSync(overlay, 'utf8')).toThrow()
    expect(() => readFileSync(catalog, 'utf8')).toThrow()
  })

  it('clear-key only deletes the clone credential ref', () => {
    deleted.length = 0
    const home = mkdtempSync(path.join(tmpdir(), 'ringcode-clearkey-'))
    mkdirSync(path.join(home, '.ringcode'), { recursive: true })
    writeFileSync(
      path.join(home, '.ringcode', 'owned-resources.json'),
      JSON.stringify({
        version: 1,
        items: [
          { kind: 'credential', id: 'ringcode:clone:clone-a', cloneId: 'clone-a' },
          { kind: 'launcher', path: 'C:\\x.cmd', cloneId: 'clone-a', commandName: 'x' },
        ],
      }),
    )
    const results = clearKeyResource('clone-a', home)
    expect(results).toEqual([expect.objectContaining({ kind: 'credential', target: 'ringcode:clone:clone-a', ok: true })])
    expect(deleted).toEqual(['ringcode:clone:clone-a'])
  })
})
