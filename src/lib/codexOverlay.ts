import { cloneCodexProfileName } from './agentClone'

export const CODEX_CLONE_ENV_KEY = 'RINGCODE_CODEX_KEY'
export const CODEX_OFFICIAL_BASE_URL = 'https://api.openai.com/v1'
export const RINGCODE_OVERLAY_MARKER = 'Owned by RingCode.'
export const CODEX_PROVIDER_ALIAS_ID = 'codex-provider-alias'
export const CODEX_PROVIDER_ALIAS_PROFILE = 'ringcode-provider-alias'

export interface CodexOverlayInput {
  cloneId: string
  baseUrl?: string
  model?: string
  modelMode?: 'default' | 'custom'
}

export function overlayOwnedBy(content: string, cloneId: string): boolean {
  return content.includes(`${RINGCODE_OVERLAY_MARKER} cloneId=${cloneId}`)
}

export function buildCodexOverlayToml(input: CodexOverlayInput): { profileName: string; content: string } {
  const profileName = cloneCodexProfileName(input.cloneId)
  const baseUrl = input.baseUrl?.trim() || CODEX_OFFICIAL_BASE_URL
  const lines = [
    `# ${RINGCODE_OVERLAY_MARKER} cloneId=${input.cloneId}`,
    '# Do not edit these marker lines. RingCode regenerates this file from current clone settings.',
    '',
    'model_provider = "ringcode-clone"',
  ]
  if (input.modelMode === 'custom' && input.model?.trim()) {
    lines.push(`model = ${tomlString(input.model.trim())}`)
  }
  lines.push(
    '',
    '[model_providers.ringcode-clone]',
    'name = "RingCode clone"',
    `base_url = ${tomlString(baseUrl)}`,
    `env_key = ${tomlString(CODEX_CLONE_ENV_KEY)}`,
    'wire_api = "responses"',
    '',
  )
  return { profileName, content: lines.join('\n') }
}

/** 分身会话会把 model_provider=ringcode-clone 写进 jsonl；删除 overlay 后原版 resume 需要这份定义。不设顶层 model_provider，以免原版新建会话改走分身线路。 */
export function buildCodexProviderAliasToml(): { profileName: string; content: string } {
  const content = [
    `# ${RINGCODE_OVERLAY_MARKER} cloneId=${CODEX_PROVIDER_ALIAS_ID}`,
    '# Compatibility overlay for resuming clone-created Codex sessions after the clone is deleted.',
    '',
    '[model_providers.ringcode-clone]',
    'name = "RingCode clone"',
    `base_url = ${tomlString(CODEX_OFFICIAL_BASE_URL)}`,
    'wire_api = "responses"',
    'requires_openai_auth = true',
    '',
  ].join('\n')
  return { profileName: CODEX_PROVIDER_ALIAS_PROFILE, content }
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}
