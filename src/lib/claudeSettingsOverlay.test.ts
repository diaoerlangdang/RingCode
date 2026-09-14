import { describe, expect, it } from 'vitest'
import { applyClaudeSettingsSecret, buildClaudeCloneSettingsEnv } from './claudeSettingsOverlay'

describe('claudeSettingsOverlay', () => {
  it('有 URL 时覆盖用户 settings.json 的 DeepSeek 线路和模型', () => {
    const env = buildClaudeCloneSettingsEnv({
      baseUrl: 'https://api.xiaomimimo.com/anthropic',
      model: 'mimo-v2.5-pro',
      modelMode: 'custom',
      injectKey: 'ANTHROPIC_AUTH_TOKEN',
    })
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.xiaomimimo.com/anthropic')
    expect(env.ANTHROPIC_API_KEY).toBe('')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('')
    expect(env.ANTHROPIC_MODEL).toBe('mimo-v2.5-pro')
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('mimo-v2.5-pro')
    const filled = applyClaudeSettingsSecret(env, 'ANTHROPIC_AUTH_TOKEN', 'clone-secret')
    expect(filled.ANTHROPIC_AUTH_TOKEN).toBe('clone-secret')
    expect(filled.ANTHROPIC_API_KEY).toBe('')
  })

  it('无 URL 时清空家目录里的网关，改走 API Key', () => {
    const env = buildClaudeCloneSettingsEnv({
      baseUrl: '',
      modelMode: 'default',
      injectKey: 'ANTHROPIC_API_KEY',
    })
    expect(env.ANTHROPIC_BASE_URL).toBe('')
    expect(env.ANTHROPIC_MODEL).toBe('')
    const filled = applyClaudeSettingsSecret(env, 'ANTHROPIC_API_KEY', 'official-key')
    expect(filled.ANTHROPIC_API_KEY).toBe('official-key')
    expect(filled.ANTHROPIC_AUTH_TOKEN).toBe('')
  })
})
