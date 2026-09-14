import { cloneCodexProfileName } from './agentClone'

export const CODEX_CLONE_ENV_KEY = 'RINGCODE_CODEX_KEY'
export const CODEX_OFFICIAL_BASE_URL = 'https://api.openai.com/v1'
export const RINGCODE_OVERLAY_MARKER = 'Owned by RingCode.'

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

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}
