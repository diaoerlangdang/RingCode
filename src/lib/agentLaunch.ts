import type { AgentDef, PermissionChoice } from '@/types'

export function permissionChoicesFor(agent: Pick<AgentDef, 'permission'>): PermissionChoice[] {
  if (!agent.permission) return []
  const choices: PermissionChoice[] = ['default', 'auto']
  if (agent.permission.dangerousArgs.join(' ') !== agent.permission.autoArgs.join(' ')) {
    choices.push('dangerous')
  }
  return choices
}

export function resolveLaunchPermission(
  agent: Pick<AgentDef, 'id' | 'permission'>,
  saved: Partial<Record<string, PermissionChoice>>,
): PermissionChoice | undefined {
  const choices = permissionChoicesFor(agent)
  if (choices.length === 0) return undefined
  const remembered = saved[agent.id]
  if (remembered && choices.includes(remembered)) return remembered
  return agent.id === 'claude' ? 'auto' : 'default'
}

type LaunchFailureReason = 'workspace' | 'profile' | 'runtime' | 'executable'

type LaunchPreparation =
  | { ok: true; profileId: string; cwd: string; permission: PermissionChoice | undefined }
  | { ok: false; reason: LaunchFailureReason; openSettings: boolean }

interface LaunchPreparationInput {
  agent: Pick<AgentDef, 'id' | 'permission'>
  workspace?: { path: string }
  profile?: { id: string; command: string }
  permissionByAgent: Partial<Record<string, PermissionChoice>>
  runtimeAvailable: boolean
}

export async function prepareAgentLaunch(
  input: LaunchPreparationInput,
  executableExists: (command: string) => Promise<boolean>,
): Promise<LaunchPreparation> {
  if (!input.workspace) return { ok: false, reason: 'workspace', openSettings: false }
  if (!input.profile?.command.trim()) return { ok: false, reason: 'profile', openSettings: true }
  if (!input.runtimeAvailable) return { ok: false, reason: 'runtime', openSettings: false }
  if (!(await executableExists(input.profile.command.trim()))) {
    return { ok: false, reason: 'executable', openSettings: true }
  }
  return {
    ok: true,
    profileId: input.profile.id,
    cwd: input.workspace.path,
    permission: resolveLaunchPermission(input.agent, input.permissionByAgent),
  }
}
