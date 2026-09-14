import { agentById } from './agents'
import { cloneCodexProfileName } from './agentClone'
import { agentFamilyOf, isCloneAgent, usesCurrentEntryConfig } from './agentFamily'
import { buildCodexOverlayToml } from './codexOverlay'
import { launchEnvPlanFor, type LaunchEnvPlan } from './launchEnv'
import type { AgentDef, PermissionChoice, ToolProfile } from '@/types'

export function permissionChoicesFor(agent: Pick<AgentDef, 'permission'>): PermissionChoice[] {
  if (!agent.permission) return []
  const choices: PermissionChoice[] = ['default', 'auto']
  if (agent.permission.dangerousArgs.join(' ') !== agent.permission.autoArgs.join(' ')) {
    choices.push('dangerous')
  }
  return choices
}

export function resolveLaunchPermission(
  agent: Pick<AgentDef, 'id' | 'permission' | 'sourceFamily'>,
  saved: Partial<Record<string, PermissionChoice>>,
): PermissionChoice | undefined {
  const choices = permissionChoicesFor(agent)
  if (choices.length === 0) return undefined
  const remembered = saved[agent.id]
  if (remembered && choices.includes(remembered)) return remembered
  return agent.id === 'claude' || agent.sourceFamily === 'claude' ? 'auto' : 'default'
}

export interface CurrentLaunchConfig {
  agent: AgentDef
  family: string
  profile: ToolProfile
  command: string
  model?: string
  modelMode: 'default' | 'custom'
  baseUrl: string
  permission: PermissionChoice | undefined
  credentialRef?: string
  requireCredential: boolean
  envPlan: LaunchEnvPlan
  codexProfile?: string
  overlay?: { profileName: string; content: string; cloneId: string }
}

export function resolveCurrentLaunchConfig(input: {
  agent: AgentDef
  profile?: ToolProfile
  permissionByAgent: Partial<Record<string, PermissionChoice>>
}): CurrentLaunchConfig | { ok: false; reason: 'profile' } {
  const profile = input.profile
  if (!profile?.command.trim()) return { ok: false, reason: 'profile' }
  const clone = isCloneAgent(input.agent)
  const family = agentFamilyOf(input.agent)
  const modelMode = profile.modelMode === 'custom' && profile.model.trim() ? 'custom' : 'default'
  const baseUrl = clone ? (profile.baseUrl ?? '').trim() : ''
  const envPlan = launchEnvPlanFor(input.agent, { baseUrl })
  const overlay =
    clone && family === 'codex'
      ? { ...buildCodexOverlayToml({ cloneId: input.agent.id, baseUrl, model: profile.model, modelMode }), cloneId: input.agent.id }
      : undefined
  return {
    agent: input.agent,
    family,
    profile,
    command: profile.command.trim(),
    model: modelMode === 'custom' ? profile.model.trim() : undefined,
    modelMode,
    baseUrl,
    permission: resolveLaunchPermission(input.agent, input.permissionByAgent),
    credentialRef: profile.credentialRef,
    requireCredential: clone,
    envPlan,
    codexProfile: overlay?.profileName ?? (clone && family === 'codex' ? cloneCodexProfileName(input.agent.id) : undefined),
    overlay,
  }
}

type LaunchFailureReason = 'workspace' | 'profile' | 'runtime' | 'executable' | 'credential'

type LaunchPreparation =
  | { ok: true; profileId: string; cwd: string; permission: PermissionChoice | undefined }
  | { ok: false; reason: LaunchFailureReason; openSettings: boolean; settingsTab?: 'profiles' | 'keys' }

interface LaunchPreparationInput {
  agent: Pick<AgentDef, 'id' | 'permission' | 'sourceFamily'>
  workspace?: { path: string }
  profile?: { id: string; command: string; credentialRef?: string }
  permissionByAgent: Partial<Record<string, PermissionChoice>>
  runtimeAvailable: boolean
  requireCredential?: boolean
  credentialPresent?: boolean
}

export async function prepareAgentLaunch(
  input: LaunchPreparationInput,
  executableExists: (command: string) => Promise<boolean>,
): Promise<LaunchPreparation> {
  if (!input.workspace) return { ok: false, reason: 'workspace', openSettings: false }
  if (!input.profile?.command.trim()) return { ok: false, reason: 'profile', openSettings: true, settingsTab: 'profiles' }
  if (!input.runtimeAvailable) return { ok: false, reason: 'runtime', openSettings: false }
  const requireCredential = input.requireCredential ?? isCloneAgent(input.agent)
  if (requireCredential && !input.credentialPresent) {
    return { ok: false, reason: 'credential', openSettings: true, settingsTab: 'keys' }
  }
  if (!(await executableExists(input.profile.command.trim()))) {
    return { ok: false, reason: 'executable', openSettings: true, settingsTab: 'profiles' }
  }
  return {
    ok: true,
    profileId: input.profile.id,
    cwd: input.workspace.path,
    permission: resolveLaunchPermission(input.agent, input.permissionByAgent),
  }
}

export function currentConfigForTool(
  tool: string,
  extra: AgentDef[],
  profile: ToolProfile | undefined,
  permissionByAgent: Partial<Record<string, PermissionChoice>>,
): CurrentLaunchConfig | { ok: false; reason: 'profile' | 'agent' } {
  const agent = agentById(tool, extra)
  if (!agent) return { ok: false, reason: 'agent' }
  const resolved = resolveCurrentLaunchConfig({ agent, profile, permissionByAgent })
  if ('ok' in resolved && resolved.ok === false) return resolved
  return resolved
}

export { usesCurrentEntryConfig }
