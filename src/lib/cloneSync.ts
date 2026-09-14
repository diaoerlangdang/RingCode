import { cloneCodexProfileName } from './agentClone'
import { isCloneAgent } from './agentFamily'
import { resolveCurrentLaunchConfig } from './agentLaunch'
import type { AgentDef, PermissionChoice, ToolProfile } from '@/types'

export async function syncCloneResources(
  agent: AgentDef,
  profile: ToolProfile,
  permission?: PermissionChoice,
): Promise<{
  launcherOk: boolean
  launcherPath?: string
  launcherReason?: string
}> {
  const api = window.ringcode
  if (!isCloneAgent(agent) || !api) return { launcherOk: false, launcherReason: '需要桌面环境' }
  const cfg = resolveCurrentLaunchConfig({
    agent,
    profile,
    permissionByAgent: permission ? { [agent.id]: permission } : {},
  })
  if ('ok' in cfg && cfg.ok === false) return { launcherOk: false, launcherReason: '缺少有效启动配置' }
  if (!('ok' in cfg) && cfg.overlay) {
    const overlay = await api.writeCodexOverlay(cfg.overlay)
    if (!overlay.ok) return { launcherOk: false, launcherReason: overlay.reason }
  }
  if (profile.credentialRef) {
    await api.registerOwnedResource({ kind: 'credential', id: profile.credentialRef, cloneId: agent.id })
  }
  const family = agent.sourceFamily
  if (family !== 'claude' && family !== 'codex') return { launcherOk: false, launcherReason: '不支持的家族' }
  const result = await api.cloneSync({
    snapshot: {
      version: 1,
      cloneId: agent.id,
      commandName: agent.commandName ?? '',
      name: agent.name,
      family,
      command: profile.command,
      model: profile.model,
      modelMode: profile.modelMode === 'custom' ? 'custom' : 'default',
      baseUrl: profile.baseUrl ?? '',
      permission: !('ok' in cfg) ? cfg.permission : undefined,
      credentialRef: profile.credentialRef ?? '',
      codexProfileName: family === 'codex' ? cloneCodexProfileName(agent.id) : undefined,
      updatedAt: Date.now(),
    },
  })
  if (!result.launcher.ok) return { launcherOk: false, launcherReason: result.launcher.reason }
  return { launcherOk: true, launcherPath: result.launcher.path }
}
