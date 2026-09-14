import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildAppLaunchCmd, buildCloneLauncherCmd, launcherOwnedBy, writeAppLaunchPointer, writeCloneLauncher } from './cloneLauncherFile'

describe('clone launcher files', () => {
  it('writes owned cmd files and refuses foreign files', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ringcode-launcher-'))
    const first = writeCloneLauncher({ cloneId: 'clone-a', commandName: 'cheap-codex' }, home)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const content = readFileSync(first.path, 'utf8')
    expect(launcherOwnedBy(content, 'clone-a')).toBe(true)
    expect(content).toContain('cheap-codex')
    expect(buildAppLaunchCmd({ exe: 'C:\\app\\RingCode.exe', script: 'C:\\app\\helper.js' })).toContain('ELECTRON_RUN_AS_NODE')
    expect(buildCloneLauncherCmd('clone-a', 'cheap-codex', home)).toContain('cloneId=clone-a')

    const foreign = path.join(home, '.ringcode', 'bin', 'taken.cmd')
    mkdirSync(path.dirname(foreign), { recursive: true })
    writeFileSync(foreign, '@echo off\necho hi\n')
    const blocked = writeCloneLauncher({ cloneId: 'clone-a', commandName: 'taken' }, home)
    expect(blocked.ok).toBe(false)
  })

  it('quotes install paths that contain spaces', () => {
    const cmd = buildAppLaunchCmd({
      exe: 'C:\\Program Files\\RingCode\\RingCode.exe',
      script: 'C:\\Program Files\\RingCode\\resources\\cloneLaunchCli.js',
    })
    expect(cmd).toContain('"C:\\Program Files\\RingCode\\RingCode.exe" "C:\\Program Files\\RingCode\\resources\\cloneLaunchCli.js" %*')
  })

  it('cmd helper forwards cloneId and quoted arguments with spaces', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ringcode-launcher-args-'))
    const bin = path.join(home, '.ringcode')
    mkdirSync(bin, { recursive: true })
    const dump = path.join(bin, 'dump-args.mjs')
    const out = path.join(bin, 'argv.json')
    writeFileSync(dump, `import fs from 'node:fs'\nfs.writeFileSync(process.env.RINGCODE_DUMP, JSON.stringify(process.argv.slice(2)))\n`)
    writeAppLaunchPointer({ exe: process.execPath, script: dump }, home)
    const launcher = writeCloneLauncher({ cloneId: 'clone-space', commandName: 'rc-space' }, home)
    expect(launcher.ok).toBe(true)
    if (!launcher.ok) return
    const caller = path.join(bin, 'call-space.cmd')
    writeFileSync(caller, `@echo off\r\ncall "${launcher.path}" resume "sess with space" --cwd "D:\\my project"\r\n`)
    const result = spawnSync('cmd.exe', ['/d', '/s', '/c', caller], {
      env: { ...process.env, RINGCODE_DUMP: out },
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual([
      'clone-space',
      'resume',
      'sess with space',
      '--cwd',
      'D:\\my project',
    ])
  })
})
