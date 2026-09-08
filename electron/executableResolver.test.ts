import { describe, expect, it } from 'vitest'
import { resolveExecutablePath, resolvePtyExecutable } from './executableResolver'

describe('resolvePtyExecutable', () => {
  it('CLI 不存在时给出可操作的错误，而不是创建无输出的黑框', () => {
    expect(() => resolvePtyExecutable('opencode', {
      platform: 'win32',
      env: { PATH: '', PATHEXT: '.EXE;.CMD;.BAT' },
      exists: () => false,
    })).toThrow(/未找到.*opencode/i)
  })

  it('同一解析结果可供 PTY 和历史子进程复用', () => {
    const target = 'C:\\Users\\demo\\.opencode\\bin\\opencode.exe'
    const options = {
      platform: 'win32' as const,
      env: { USERPROFILE: 'C:\\Users\\demo', PATH: '', PATHEXT: '.EXE' },
      exists: (file: string) => file === target,
    }
    expect(resolveExecutablePath('opencode', options)).toBe(target)
    expect(resolvePtyExecutable('opencode', options)).toEqual({ exe: target, args: [] })
  })

  it('批处理启动器通过子进程环境变量保留含空格的绝对路径', () => {
    const target = 'C:\\Program Files\\nodejs\\codex.cmd'
    const options = {
      platform: 'win32' as const,
      env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe', PATH: '', PATHEXT: '.CMD' },
      exists: (file: string) => file === target,
    }

    expect(resolvePtyExecutable(target, options)).toEqual({
      exe: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', '%RINGCODE_BATCH_ENTRY%'],
      env: { RINGCODE_BATCH_ENTRY: '"C:\\Program Files\\nodejs\\codex.cmd"' },
    })
  })
})
