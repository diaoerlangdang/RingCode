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

  it('识别 OpenAI 桌面版 Codex 的 bin 哈希目录和 CODEX_CLI_PATH', () => {
    const paths = knownWindowsAgentPaths(
      'codex',
      {
        LOCALAPPDATA: 'C:\\Users\\demo\\AppData\\Local',
        CODEX_CLI_PATH: 'C:\\pinned\\codex.exe',
      },
      () => ['7ac07f4ce733f89a'],
    )
    expect(paths).toContain('C:\\pinned\\codex.exe')
    expect(paths).toContain('C:\\Users\\demo\\AppData\\Local\\OpenAI\\Codex\\bin\\7ac07f4ce733f89a\\codex.exe')
  })
})
