import { describe, expect, it } from 'vitest'
import { knownWindowsAgentPaths } from './agentPaths'

describe('knownWindowsAgentPaths', () => {
  it('识别 Antigravity CLI 的官方 Windows 用户级安装目录', () => {
    expect(knownWindowsAgentPaths('agy', { LOCALAPPDATA: 'C:\\Users\\demo\\AppData\\Local' })).toEqual([
      'C:\\Users\\demo\\AppData\\Local\\agy\\bin\\agy.exe',
    ])
    expect(knownWindowsAgentPaths('agy.exe', { LOCALAPPDATA: 'C:\\Users\\demo\\AppData\\Local' })).toHaveLength(1)
  })

  it('识别 OpenCode 官方脚本、npm 与 Windows 包管理器的常用安装目录', () => {
    const paths = knownWindowsAgentPaths('opencode', {
      USERPROFILE: 'C:\\Users\\demo',
      APPDATA: 'C:\\Users\\demo\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\demo\\AppData\\Local',
      ProgramData: 'C:\\ProgramData',
    })
    expect(paths).toContain('C:\\Users\\demo\\.opencode\\bin\\opencode.exe')
    expect(paths).toContain('C:\\Users\\demo\\AppData\\Roaming\\npm\\opencode.cmd')
    expect(paths).toContain('C:\\Users\\demo\\scoop\\shims\\opencode.exe')
  })
})
