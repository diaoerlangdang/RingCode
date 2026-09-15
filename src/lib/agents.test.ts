import { describe, expect, it } from 'vitest'
import {
  BUILTIN_AGENTS,
  agentById,
  buildLaunchArgs,
  migrateProfilesForBuiltinAgents,
  terminalCompatibilityEnv,
  seedProfilesFromAgents,
  supportsNativeFork,
} from './agents'

describe('agent registry', () => {
  it('内置按顶栏顺序包含五个 Agent，按 id 可查', () => {
    expect(BUILTIN_AGENTS.map((a) => a.id)).toEqual(['claude', 'codex', 'opencode', 'antigravity', 'hermes'])
    expect(agentById('hermes')?.command).toBe('hermes')
    expect(agentById('nope')).toBeUndefined()
  })

  it('自定义 Agent 可并入列表而不改内置表', () => {
    const extra = { ...agentById('hermes')!, id: 'mybot', name: 'MyBot', command: 'mybot' }
    const all = [...BUILTIN_AGENTS, extra]
    expect(all.find((a) => a.id === 'mybot')?.command).toBe('mybot')
    expect(BUILTIN_AGENTS).toHaveLength(5)
  })

  it('Claude Auto 追加 --permission-mode auto，危险模式追加 --dangerously-skip-permissions', () => {
    const a = agentById('claude')!
    expect(buildLaunchArgs(a, '', { permission: 'auto' })).toEqual(['--permission-mode', 'auto'])
    expect(buildLaunchArgs(a, '', { permission: 'dangerous' })).toEqual(['--dangerously-skip-permissions'])
    expect(buildLaunchArgs(a, '--permission-mode acceptEdits', { permission: 'auto' })).toEqual([
      '--permission-mode',
      'acceptEdits',
    ])
  })

  it('Codex 保留原生终端模式并按权限追加参数', () => {
    const a = agentById('codex')!
    expect(buildLaunchArgs(a, '', { permission: 'default' })).toEqual([])
    expect(buildLaunchArgs(a, '', { permission: 'auto' })).toEqual([
      '--ask-for-approval',
      'never',
      '--sandbox',
      'workspace-write',
    ])
    expect(buildLaunchArgs(a, '', { permission: 'dangerous' })).toEqual([
      '--dangerously-bypass-approvals-and-sandbox',
    ])
  })

  it('Codex 使用 Windows Terminal 兼容的 scrollback 策略', () => {
    expect(terminalCompatibilityEnv('codex', 'tab-1')).toEqual({ WT_SESSION: 'RingCode-tab-1' })
    expect(terminalCompatibilityEnv('claude', 'tab-1')).toEqual({})
    expect(terminalCompatibilityEnv('hermes', 'tab-1')).toEqual({})
  })

  it('Hermes 的 Auto/危险模式使用 --yolo', () => {
    const a = agentById('hermes')!
    expect(buildLaunchArgs(a, '', { permission: 'auto' })).toEqual(['--yolo'])
    expect(buildLaunchArgs(a, '', { permission: 'dangerous' })).toEqual(['--yolo'])
  })

  it('OpenCode 生成 Auto、模型、恢复和原生分叉参数', () => {
    const a = agentById('opencode')!
    expect(buildLaunchArgs(a, '', { permission: 'auto' })).toEqual(['--auto'])
    expect(buildLaunchArgs(a, '', { modelMode: 'custom', model: 'anthropic/claude-sonnet-4-5' })).toEqual([
      '--model',
      'anthropic/claude-sonnet-4-5',
    ])
    expect(buildLaunchArgs(a, '', { action: 'resume', nativeSessionId: 'ses_1' })).toEqual(['--session', 'ses_1'])
    expect(buildLaunchArgs(a, '', { action: 'fork', nativeSessionId: 'ses_1' })).toEqual([
      '--session',
      'ses_1',
      '--fork',
    ])
  })

  it('Antigravity 生成权限、模型、恢复和交互首条 prompt 参数', () => {
    const a = agentById('antigravity')!
    expect(buildLaunchArgs(a, '', { permission: 'auto' })).toEqual(['--mode=accept-edits'])
    expect(buildLaunchArgs(a, '', { permission: 'dangerous' })).toEqual(['--dangerously-skip-permissions'])
    expect(buildLaunchArgs(a, '', { action: 'resume', nativeSessionId: 'g1' })).toEqual(['--conversation', 'g1'])
    expect(buildLaunchArgs(a, '', { modelMode: 'custom', model: 'gemini-3.5-flash-medium', initialPrompt: '继续分析' })).toEqual([
      '--model',
      'gemini-3.5-flash-medium',
      '--prompt-interactive',
      '继续分析',
    ])
  })

  it('跟随默认模型时不传模型，显式参数优先于模型字段', () => {
    const a = agentById('codex')!
    expect(buildLaunchArgs(a, '', { modelMode: 'default', model: 'gpt-5' })).toEqual([])
    expect(buildLaunchArgs(a, '--model custom', { modelMode: 'custom', model: 'ignored' })).toEqual(['--model', 'custom'])
  })

  it('resume 保留会话原来的权限模式', () => {
    const a = agentById('claude')!
    expect(buildLaunchArgs(a, '', { permission: 'dangerous', action: 'resume', nativeSessionId: 'abc' })).toEqual([
      '--resume',
      'abc',
      '--dangerously-skip-permissions',
    ])
  })

  it('按 Agent 生成真实的恢复与分叉命令', () => {
    const claude = agentById('claude')!
    const codex = agentById('codex')!
    const hermes = agentById('hermes')!

    expect(buildLaunchArgs(claude, '', { action: 'fork', nativeSessionId: 'c1' })).toEqual([
      '--resume',
      'c1',
      '--fork-session',
    ])
    expect(buildLaunchArgs(codex, '', { action: 'resume', nativeSessionId: 'x1' })).toEqual(['resume', 'x1'])
    expect(buildLaunchArgs(codex, '', { action: 'fork', nativeSessionId: 'x1' })).toEqual(['fork', 'x1'])
    expect(buildLaunchArgs(codex, '', { action: 'resume', nativeSessionId: 'x1', codexProvider: 'openai' })).toEqual([
      '-c',
      'model_provider="openai"',
      'resume',
      'x1',
    ])
    expect(buildLaunchArgs(codex, '', { action: 'new', codexProvider: 'openai' })).toEqual([])
    expect(buildLaunchArgs(hermes, '', { action: 'resume', nativeSessionId: 'h1' })).toEqual(['--resume', 'h1'])
    expect(supportsNativeFork(claude)).toBe(true)
    expect(supportsNativeFork(codex)).toBe(true)
    expect(supportsNativeFork(hermes)).toBe(false)
  })

  it('种子配置方案覆盖每个内置 Agent', () => {
    const ps = seedProfilesFromAgents()
    expect(ps.map((p) => p.tool)).toEqual(['claude', 'codex', 'opencode', 'antigravity', 'hermes'])
    expect(ps.every((p) => p.modelMode === 'default')).toBe(true)
    expect(ps[0].credentialRef).toBe('ringcode:anthropic-key')
  })

  it('旧配置迁移后补齐新 Agent，并继续跟随 CLI 默认模型', () => {
    const oldClaude = { ...seedProfilesFromAgents()[0], modelMode: undefined }

    const migrated = migrateProfilesForBuiltinAgents([oldClaude])
    expect(migrated.map((profile) => profile.tool)).toEqual(['claude', 'codex', 'opencode', 'antigravity', 'hermes'])
    expect(migrated.every((profile) => profile.modelMode === 'default')).toBe(true)
  })

  it('将刚加入的 Gemini 默认方案迁移为 Antigravity CLI', () => {
    const migrated = migrateProfilesForBuiltinAgents([{
      ...seedProfilesFromAgents()[0],
      id: 'pf-gemini-default',
      name: '默认 · Gemini CLI',
      tool: 'gemini',
      command: 'gemini',
      model: 'auto',
    }])
    const profile = migrated.find((item) => item.tool === 'antigravity')!
    expect(profile).toMatchObject({
      id: 'pf-antigravity-default',
      name: '默认 · Antigravity CLI',
      command: 'agy',
      model: '',
    })
  })
})
