import { CODEX_CLONE_ENV_KEY } from './codexOverlay'
import { isCloneAgent } from './agentFamily'
import type { AgentDef } from '@/types'

const CLAUDE_HOME_KEYS = ['CLAUDE_CONFIG_DIR', 'CLAUDE_HOME', 'CLAUDE_CONFIG_HOME']
const CLAUDE_CRED_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL']
const CODEX_HOME_KEYS = ['CODEX_HOME']
const CODEX_CRED_KEYS = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_API_BASE', 'HJ_CODEX_API_KEY', CODEX_CLONE_ENV_KEY]

export interface LaunchEnvPlan {
  unsetKeys: string[]
  injectKey?: string
  extraEnv: Record<string, string>
}

export function launchEnvPlanFor(
  agent: Pick<AgentDef, 'id' | 'sourceFamily'>,
  opts: { baseUrl?: string } = {},
): LaunchEnvPlan {
  if (!isCloneAgent(agent)) return { unsetKeys: [], extraEnv: {} }
  if (agent.sourceFamily === 'claude') {
    const url = opts.baseUrl?.trim()
    const unsetKeys = [...CLAUDE_HOME_KEYS, ...CLAUDE_CRED_KEYS]
    if (url) {
      return {
        unsetKeys,
        injectKey: 'ANTHROPIC_AUTH_TOKEN',
        extraEnv: { ANTHROPIC_BASE_URL: url },
      }
    }
    return { unsetKeys, injectKey: 'ANTHROPIC_API_KEY', extraEnv: {} }
  }
  return {
    unsetKeys: [...CODEX_HOME_KEYS, ...CODEX_CRED_KEYS],
    injectKey: CODEX_CLONE_ENV_KEY,
    extraEnv: {},
  }
}

export function applyLaunchEnvPlan(
  env: Record<string, string | undefined>,
  plan: LaunchEnvPlan,
  secret?: string | null,
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value == null) continue
    next[key] = value
  }
  for (const key of plan.unsetKeys) delete next[key]
  Object.assign(next, plan.extraEnv)
  if (plan.injectKey && secret) next[plan.injectKey] = secret
  return next
}
