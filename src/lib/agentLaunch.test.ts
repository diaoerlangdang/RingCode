import { describe, expect, it } from 'vitest'
import { agentById } from './agents'
import { permissionChoicesFor, prepareAgentLaunch, resolveLaunchPermission } from './agentLaunch'

describe('Agent 启动权限', () => {
  it('Claude 无历史设置时使用 Auto，保存危险模式后恢复危险模式', () => {
    const claude = agentById('claude')!

    expect(resolveLaunchPermission(claude, {})).toBe('auto')
    expect(resolveLaunchPermission(claude, { claude: 'dangerous' })).toBe('dangerous')
  })

  it('每个 Agent 独立读取自己的权限设置', () => {
    const hermes = agentById('hermes')!

    expect(resolveLaunchPermission(hermes, { claude: 'dangerous', hermes: 'auto' })).toBe('auto')
  })

  it('没有权限配置的 Agent 不传权限参数', () => {
    expect(resolveLaunchPermission({ id: 'plain-agent' }, { 'plain-agent': 'dangerous' })).toBeUndefined()
  })

  it('只有 Auto 与危险参数不同时才提供独立的危险选项', () => {
    expect(permissionChoicesFor(agentById('claude')!)).toEqual(['default', 'auto', 'dangerous'])
    expect(permissionChoicesFor(agentById('codex')!)).toEqual(['default', 'auto', 'dangerous'])
    expect(permissionChoicesFor(agentById('opencode')!)).toEqual(['default', 'auto'])
    expect(permissionChoicesFor(agentById('antigravity')!)).toEqual(['default', 'auto', 'dangerous'])
    expect(permissionChoicesFor(agentById('hermes')!)).toEqual(['default', 'auto'])
  })
})

describe('Agent 启动准备', () => {
  const agent = agentById('claude')!
  const workspace = { path: 'C:\\workspace' }
  const profile = { id: 'pf-claude-default', command: 'claude' }

  it('配置完整且可执行文件存在时生成直接启动计划', async () => {
    const result = await prepareAgentLaunch(
      {
        agent,
        workspace,
        profile,
        permissionByAgent: { claude: 'dangerous' },
        runtimeAvailable: true,
      },
      async () => true,
    )

    expect(result).toEqual({
      ok: true,
      profileId: 'pf-claude-default',
      cwd: 'C:\\workspace',
      permission: 'dangerous',
    })
  })

  it('没有工作区时提示先选择工作区，不打开设置', async () => {
    const result = await prepareAgentLaunch(
      { agent, profile, permissionByAgent: {}, runtimeAvailable: true },
      async () => true,
    )

    expect(result).toEqual({ ok: false, reason: 'workspace', openSettings: false })
  })

  it('没有配置方案或命令为空时打开配置方案设置', async () => {
    const noProfile = await prepareAgentLaunch(
      { agent, workspace, permissionByAgent: {}, runtimeAvailable: true },
      async () => true,
    )
    const noCommand = await prepareAgentLaunch(
      {
        agent,
        workspace,
        profile: { ...profile, command: '   ' },
        permissionByAgent: {},
        runtimeAvailable: true,
      },
      async () => true,
    )

    expect(noProfile).toEqual({ ok: false, reason: 'profile', openSettings: true, settingsTab: 'profiles' })
    expect(noCommand).toEqual({ ok: false, reason: 'profile', openSettings: true, settingsTab: 'profiles' })
  })

  it('CLI 不存在时打开配置方案设置', async () => {
    const result = await prepareAgentLaunch(
      { agent, workspace, profile, permissionByAgent: {}, runtimeAvailable: true },
      async () => false,
    )

    expect(result).toEqual({ ok: false, reason: 'executable', openSettings: true, settingsTab: 'profiles' })
  })

  it('桌面运行时不可用时只提示错误，不打开配置设置', async () => {
    const result = await prepareAgentLaunch(
      { agent, workspace, profile, permissionByAgent: {}, runtimeAvailable: false },
      async () => true,
    )

    expect(result).toEqual({ ok: false, reason: 'runtime', openSettings: false })
  })
})
