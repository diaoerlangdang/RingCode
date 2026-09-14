import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeCloneSnapshot, type CloneSnapshot } from './cloneSnapshot'

vi.mock('./cred', () => ({
  getCredential: vi.fn(() => 'test-secret'),
}))

const { getCredential } = await import('./cred')
const { buildCloneHelperArgv, runCloneLaunch, stripCodexProfileArgs } = await import('./cloneLaunchRun')

const snapshot: CloneSnapshot = {
  version: 1,
  cloneId: 'c1',
  commandName: 'cheap-codex',
  name: '便宜版',
  family: 'codex',
  command: 'codex',
  model: 'gpt-x',
  modelMode: 'custom',
  baseUrl: 'https://gw.example/v1',
  permission: 'auto',
  credentialRef: 'ringcode:clone:c1',
  codexProfileName: 'ringcode-c1',
  updatedAt: 1,
}

describe('clone helper argv', () => {
  it('prepending profile/model/permission and strips user --profile', () => {
    expect(stripCodexProfileArgs(['resume', 'abc', '--profile', 'other', '--foo'])).toEqual(['resume', 'abc', '--foo'])
    expect(buildCloneHelperArgv(snapshot, ['resume', 'abc', '--profile', 'other'])).toEqual([
      '--profile',
      'ringcode-c1',
      '--model',
      'gpt-x',
      '--ask-for-approval',
      'never',
      '--sandbox',
      'workspace-write',
      'resume',
      'abc',
    ])
  })

  it('keeps spaced user args as a single argv token and honors cwd', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ringcode-launch-'))
    writeCloneSnapshot({ ...snapshot, command: process.execPath, family: 'claude', commandName: 'cheap-claude' }, home)
    const spawned: { exe: string; args: string[]; cwd?: string }[] = []
    const child = new EventEmitter() as EventEmitter & { kill: () => boolean }
    child.kill = () => true
    const code = runCloneLaunch('c1', ['resume', 'session with space', '--foo bar'], {
      home,
      spawnProcess: ((exe, args, opts) => {
        spawned.push({ exe: String(exe), args: args as string[], cwd: opts?.cwd })
        queueMicrotask(() => child.emit('exit', 0, null))
        return child
      }) as typeof import('node:child_process').spawn,
      cwd: path.join(home, 'proj dir'),
    })
    await expect(code).resolves.toBe(0)
    expect(spawned[0]?.exe).toBe(process.execPath)
    expect(spawned[0]?.args).toEqual(expect.arrayContaining(['resume', 'session with space', '--foo bar']))
    expect(spawned[0]?.cwd).toBe(path.join(home, 'proj dir'))
  })

  it('forwards SIGINT to the child process', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ringcode-launch-int-'))
    writeCloneSnapshot({ ...snapshot, command: process.execPath, family: 'claude', commandName: 'cheap-claude' }, home)
    const child = new EventEmitter() as EventEmitter & { killed?: string; kill: (signal?: NodeJS.Signals) => boolean }
    child.kill = (signal) => {
      child.killed = signal
      queueMicrotask(() => child.emit('exit', null, signal ?? 'SIGINT'))
      return true
    }
    const captured: Array<(signal: NodeJS.Signals) => void> = []
    const on = process.on.bind(process)
    const spy = vi.spyOn(process, 'on').mockImplementation((event, listener) => {
      if (event === 'SIGINT') captured.push(listener as (signal: NodeJS.Signals) => void)
      return on(event as NodeJS.Signals, listener as NodeJS.SignalsListener)
    })
    try {
      const pending = runCloneLaunch('c1', [], {
        home,
        spawnProcess: (() => child) as typeof import('node:child_process').spawn,
      })
      expect(captured.length).toBeGreaterThan(0)
      captured[0]!('SIGINT')
      await expect(pending).resolves.toBe(1)
      expect(child.killed).toBe('SIGINT')
    } finally {
      spy.mockRestore()
    }
  })
})

describe('clone helper missing key', () => {
  afterEach(() => {
    vi.mocked(getCredential).mockReturnValue('test-secret')
  })

  it('exits 1 without spawning when the clone key is missing', async () => {
    vi.mocked(getCredential).mockReturnValue(null)
    const home = mkdtempSync(path.join(tmpdir(), 'ringcode-launch-nokey-'))
    writeCloneSnapshot({ ...snapshot, command: process.execPath, family: 'claude', commandName: 'cheap-claude' }, home)
    let spawned = false
    const code = await runCloneLaunch('c1', ['resume', 'abc'], {
      home,
      spawnProcess: (() => {
        spawned = true
        throw new Error('should not spawn')
      }) as typeof import('node:child_process').spawn,
    })
    expect(code).toBe(1)
    expect(spawned).toBe(false)
  })
})
