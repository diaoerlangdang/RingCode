/** 覆盖 ~/.claude/settings.json 的 env：Claude Code 会用该文件盖掉进程里注入的 ANTHROPIC_*。 */

const MODEL_ENV_KEYS = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME',
  'CLAUDE_CODE_SUBAGENT_MODEL',
] as const

export function buildClaudeCloneSettingsEnv(input: {
  baseUrl?: string
  model?: string
  modelMode?: 'default' | 'custom'
  injectKey: 'ANTHROPIC_API_KEY' | 'ANTHROPIC_AUTH_TOKEN'
}): Record<string, string> {
  const env: Record<string, string> = {
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_AUTH_TOKEN: '',
    ANTHROPIC_BASE_URL: input.baseUrl?.trim() ?? '',
  }
  for (const key of MODEL_ENV_KEYS) env[key] = ''
  if (input.modelMode === 'custom' && input.model?.trim()) {
    const model = input.model.trim()
    for (const key of MODEL_ENV_KEYS) env[key] = model
  }
  void input.injectKey
  return env
}

export function applyClaudeSettingsSecret(
  env: Record<string, string>,
  injectKey: string,
  secret: string,
): Record<string, string> {
  return { ...env, [injectKey]: secret }
}

export function serializeClaudeCloneSettings(env: Record<string, string>): string {
  return `${JSON.stringify({ env }, null, 2)}\n`
}
