import { describe, expect, it } from 'vitest'
import { agentById } from './agents'
import { createCloneAgent, createCloneProfile, prepareImportedClone, validateCloneCommandName, validateCloneDisplayName } from './agentClone'
import { familyOfTool, isCloneAgent, migrateSessionCloneFields } from './agentFamily'
import { buildCodexOverlayToml, overlayOwnedBy } from './codexOverlay'
import { applyLaunchEnvPlan, launchEnvPlanFor } from './launchEnv'
import { canonicalHistoryKey, lookupHistoryAlias, migrateHistoryAliasKeys } from './historyIdentity'
import { prepareAgentLaunch, resolveCurrentLaunchConfig, resolveLaunchPermission } from './agentLaunch'
import { buildLaunchArgs, terminalCompatibilityEnv } from './agents'
import type { Session } from '@/types'

const sourceClaude = agentById('claude')!
const sourceCodex = agentById('codex')!

describe('分身命令名与身份', () => {
  it('拒绝空值、格式、设备名和已占用命令', () => {
    const ctx = { agents: [sourceClaude, sourceCodex] }
    expect(validateCloneCommandName('', ctx).ok).toBe(false)
    expect(validateCloneCommandName('Cheap Codex', ctx).ok).toBe(false)
    expect(validateCloneCommandName('con', ctx).ok).toBe(false)
    expect(validateCloneCommandName('claude', ctx).ok).toBe(false)
    expect(validateCloneCommandName('cheap-codex', ctx)).toEqual({ ok: true })
  })

  it('显示名必填且限制长度', () => {
    expect(validateCloneDisplayName('  ').ok).toBe(false)
    expect(validateCloneDisplayName('便宜版 Codex')).toEqual({ ok: true })
  })

  it('从原版复制能力但不复制凭据引用，且不能从分身再复制', () => {
    const clone = createCloneAgent(sourceCodex, { id: '11111111-1111-4111-8111-111111111111', name: '便宜版 Codex', commandName: 'cheap-codex' })
    expect(isCloneAgent(clone)).toBe(true)
    expect(clone.sourceFamily).toBe('codex')
    expect(clone.command).toBe('codex')
    expect(clone.credentialRef).toBeUndefined()
    expect(clone.session?.resumeArgs).toEqual(['resume', '{id}'])
    expect(() => createCloneAgent(clone, { id: 'x', name: 'x', commandName: 'yy' })).toThrow(/原版/)
    const profile = createCloneProfile(clone, { command: 'C:\\codex.exe' }, { baseUrl: 'https://gw.example/v1', model: 'gpt-x', modelMode: 'custom' })
    expect(profile.tool).toBe(clone.id)
    expect(profile.scope).toBe('global')
    expect(profile.credentialRef).toBe(`ringcode:clone:${clone.id}`)
    expect(profile.baseUrl).toBe('https://gw.example/v1')
    expect(profile.modelMode).toBe('custom')
  })
})

describe('当前配置与环境', () => {
  it('Claude 分身按 URL 只注入一个凭据变量，并清掉家目录覆写', () => {
    const clone = createCloneAgent(sourceClaude, { id: 'claude-clone', name: '线路 A', commandName: 'claude-a' })
    const empty = launchEnvPlanFor(clone, { baseUrl: '' })
    expect(empty.injectKey).toBe('ANTHROPIC_API_KEY')
    expect(empty.unsetKeys).toEqual(expect.arrayContaining(['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CONFIG_DIR']))
    const withUrl = launchEnvPlanFor(clone, { baseUrl: 'https://proxy.example' })
    expect(withUrl.injectKey).toBe('ANTHROPIC_AUTH_TOKEN')
    expect(withUrl.extraEnv.ANTHROPIC_BASE_URL).toBe('https://proxy.example')
    const env = applyLaunchEnvPlan(
      { ANTHROPIC_API_KEY: 'old', ANTHROPIC_AUTH_TOKEN: 'old-token', CLAUDE_CONFIG_DIR: 'C:\\other', FOO: 'keep' },
      withUrl,
      'new-key',
    )
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('new-key')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://proxy.example')
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined()
    expect(env.FOO).toBe('keep')
  })

  it('Codex 分身清 CODEX_HOME，overlay 强制独立 provider，不改用户主配置结构', () => {
    const clone = createCloneAgent(sourceCodex, { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', name: '线路 B', commandName: 'codex-b' })
    const plan = launchEnvPlanFor(clone, { baseUrl: 'https://gw.example/v1' })
    expect(plan.unsetKeys).toEqual(expect.arrayContaining(['CODEX_HOME', 'OPENAI_API_KEY']))
    const overlay = buildCodexOverlayToml({ cloneId: clone.id, baseUrl: 'https://gw.example/v1', modelMode: 'custom', model: 'mine' })
    expect(overlay.profileName).toBe(`ringcode-${clone.id}`)
    expect(overlay.content).toContain('model_provider = "ringcode-clone"')
    expect(overlay.content).toContain('base_url = "https://gw.example/v1"')
    expect(overlay.content).toContain('model = "mine"')
    expect(overlayOwnedBy(overlay.content, clone.id)).toBe(true)
    const official = buildCodexOverlayToml({ cloneId: clone.id, baseUrl: '', modelMode: 'default' })
    expect(official.content).toContain('https://api.openai.com/v1')
    expect(official.content).not.toMatch(/^model = /m)
  })

  it('原版 Codex 继续分身会话时强制切回官方 provider', () => {
    const profile = {
      id: 'pf-codex-default',
      name: '默认 · Codex',
      scope: 'global' as const,
      tool: 'codex',
      command: 'C:\\codex.exe',
      args: '',
      model: '',
      modelMode: 'default' as const,
      envs: [],
      terminalStrategy: 'new' as const,
    }
    const cfg = resolveCurrentLaunchConfig({
      agent: sourceCodex,
      profile,
      permissionByAgent: {},
    })
    expect('ok' in cfg && cfg.ok === false).toBe(false)
    if ('ok' in cfg) return
    expect(cfg.requireCredential).toBe(false)
    expect(cfg.codexProfile).toBe('ringcode-provider-alias')
    expect(cfg.codexProvider).toBe('openai')
    expect(cfg.overlay?.cloneId).toBe('codex-provider-alias')
    expect(cfg.overlay?.content).toContain('model_provider = "openai"')
    expect(cfg.overlay?.content).not.toContain('[model_providers.ringcode-clone]')
    expect(cfg.overlay?.content).not.toContain('requires_openai_auth')
    expect(cfg.overlay?.content).not.toContain('RINGCODE_CODEX_KEY')
    expect(cfg.overlay?.catalogModel).toBeUndefined()
  })

  it('分身缺 Key 拦截，原版无 Key 仍可通过启动准备', async () => {
    const clone = createCloneAgent(sourceClaude, { id: 'c1', name: 'A', commandName: 'claude-a' })
    const blocked = await prepareAgentLaunch(
      {
        agent: clone,
        workspace: { path: 'C:\\ws' },
        profile: { id: 'pf', command: 'claude', credentialRef: 'ringcode:clone:c1' },
        permissionByAgent: {},
        runtimeAvailable: true,
        credentialPresent: false,
      },
      async () => true,
    )
    expect(blocked).toMatchObject({ ok: false, reason: 'credential', settingsTab: 'keys' })
    const original = await prepareAgentLaunch(
      {
        agent: sourceClaude,
        workspace: { path: 'C:\\ws' },
        profile: { id: 'pf-claude-default', command: 'claude' },
        permissionByAgent: {},
        runtimeAvailable: true,
      },
      async () => true,
    )
    expect(original.ok).toBe(true)
  })

  it('当前配置读取分身最新模型/URL，Claude 分身默认 Auto', () => {
    const clone = createCloneAgent(sourceClaude, { id: 'c2', name: 'A', commandName: 'claude-a' })
    const profile = createCloneProfile(clone, undefined, { baseUrl: 'https://x', model: 'sonnet-x', modelMode: 'custom' })
    const cfg = resolveCurrentLaunchConfig({
      agent: clone,
      profile,
      permissionByAgent: { c2: 'dangerous' },
    })
    expect('ok' in cfg && cfg.ok === false).toBe(false)
    if ('ok' in cfg) return
    expect(cfg.requireCredential).toBe(true)
    expect(cfg.baseUrl).toBe('https://x')
    expect(cfg.model).toBe('sonnet-x')
    expect(cfg.permission).toBe('dangerous')
    expect(cfg.claudeSettings?.env.ANTHROPIC_BASE_URL).toBe('https://x')
    expect(cfg.claudeSettings?.env.ANTHROPIC_MODEL).toBe('sonnet-x')
    expect(resolveLaunchPermission(clone, {})).toBe('auto')
  })

  it('Claude 原版与分身恢复同一会话时按本次入口隔离配置', () => {
    const clone = createCloneAgent(sourceClaude, { id: 'claude-switch', name: '线路 A', commandName: 'claude-switch' })
    const cloneProfile = createCloneProfile(clone, undefined, {
      baseUrl: 'https://proxy.example/anthropic',
      model: 'clone-model',
      modelMode: 'custom',
    })
    const originalProfile = {
      id: 'pf-claude-default',
      name: '默认 · Claude Code',
      scope: 'global' as const,
      tool: 'claude',
      command: 'claude',
      args: '',
      model: '',
      modelMode: 'default' as const,
      envs: [],
      terminalStrategy: 'new' as const,
    }
    const cloneConfig = resolveCurrentLaunchConfig({ agent: clone, profile: cloneProfile, permissionByAgent: {} })
    const originalConfig = resolveCurrentLaunchConfig({ agent: sourceClaude, profile: originalProfile, permissionByAgent: {} })
    expect('ok' in cloneConfig && cloneConfig.ok === false).toBe(false)
    expect('ok' in originalConfig && originalConfig.ok === false).toBe(false)
    if ('ok' in cloneConfig || 'ok' in originalConfig) return

    expect(buildLaunchArgs(clone, '', { action: 'resume', nativeSessionId: 'same-session' })).toEqual([
      '--resume',
      'same-session',
    ])
    expect(buildLaunchArgs(sourceClaude, '', { action: 'resume', nativeSessionId: 'same-session' })).toEqual([
      '--resume',
      'same-session',
    ])
    expect(cloneConfig.claudeSettings?.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://proxy.example/anthropic',
      ANTHROPIC_MODEL: 'clone-model',
    })
    expect(cloneConfig.envPlan.injectKey).toBe('ANTHROPIC_AUTH_TOKEN')
    expect(originalConfig.claudeSettings).toBeUndefined()
    expect(originalConfig.envPlan).toEqual({ unsetKeys: [], extraEnv: {} })
  })
})

describe('启动参数与滚动兼容', () => {
  it('Codex 分身把 --profile 放在 resume/fork 之前', () => {
    expect(buildLaunchArgs(sourceCodex, '', { action: 'resume', nativeSessionId: 'x1', codexProfile: 'ringcode-a' })).toEqual([
      '--profile',
      'ringcode-a',
      'resume',
      'x1',
    ])
    expect(buildLaunchArgs(sourceCodex, '', { action: 'fork', nativeSessionId: 'x1', codexProfile: 'ringcode-a', permission: 'dangerous' })).toEqual([
      '--profile',
      'ringcode-a',
      'fork',
      'x1',
      '--dangerously-bypass-approvals-and-sandbox',
    ])
  })

  it('分身按家族使用 WT_SESSION', () => {
    expect(terminalCompatibilityEnv('clone-id', 'tab-1', 'codex')).toEqual({ WT_SESSION: 'RingCode-tab-1' })
    expect(terminalCompatibilityEnv('clone-id', 'tab-1', 'claude')).toEqual({})
  })
})

describe('历史字段迁移', () => {
  it('为 Claude/Codex 会话补 family 和 lastCloneId，其他 Agent 不猜测家族', () => {
    const local: Session = {
      id: 's1',
      title: 't',
      tool: 'claude',
      workspaceId: 'ws',
      profileId: 'pf',
      cwd: 'C:\\w',
      status: 'ended',
      createdAt: 1,
      lastActiveAt: 1,
      transcript: '',
      resumable: false,
    }
    const migrated = migrateSessionCloneFields(local)
    expect(migrated.family).toBe('claude')
    expect(migrated.lastCloneId).toBe('claude')
    const custom = migrateSessionCloneFields({ ...local, tool: 'mybot' })
    expect(custom.family).toBe('mybot')
    expect(custom.lastCloneId).toBeUndefined()
    const running = migrateSessionCloneFields({ ...local, status: 'running', nativeSessionId: 'n1', resumable: true })
    expect(running.family).toBe('claude')
    expect(running.lastCloneId).toBe('claude')
    expect(running.nativeSessionId).toBe('n1')
  })

  it('别名查找同时接受旧 tool 键和家族键', () => {
    const clone = createCloneAgent(sourceCodex, { id: 'clone-1', name: 'B', commandName: 'codex-b' })
    expect(familyOfTool(clone.id, [clone])).toBe('codex')
    const aliases = migrateHistoryAliasKeys({ 'clone-1:native': '别名' }, [clone])
    expect(aliases['codex:native']).toBe('别名')
    expect(lookupHistoryAlias(aliases, 'clone-1', 'native', [clone])).toBe('别名')
    expect(canonicalHistoryKey('codex', 'native')).toBe('codex:native')
  })

  it('导入分身会新建身份和凭据引用，不信任外来 credentialRef', () => {
    const raw = createCloneAgent(sourceCodex, { id: 'old-id', name: '线路 B', commandName: 'import-codex' })
    const rawProfile = createCloneProfile(raw, { command: 'codex' }, { baseUrl: 'https://gw.example/v1' })
    rawProfile.credentialRef = 'ringcode:clone:foreign'
    rawProfile.credentialSet = true
    const prepared = prepareImportedClone(raw, rawProfile, {
      agents: [sourceCodex],
      newId: 'new-id',
    })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.agent.id).toBe('new-id')
    expect(prepared.profile.credentialRef).toBe('ringcode:clone:new-id')
    expect(prepared.profile.credentialSet).toBe(false)
    expect(prepared.profile.baseUrl).toBe('https://gw.example/v1')
  })
})
