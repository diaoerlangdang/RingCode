import { useAppStore } from '@/store/useAppStore'
import { agentById } from './agents'
import { isCloneAgent } from './agentFamily'
import { isCleanupBlocked } from './cleanupGate'
import { prepareAgentLaunch } from './agentLaunch'
import type { PermissionChoice } from '@/types'

export async function prepareCurrentEntryLaunch(
  tool: string,
  cwd: string,
  workspaceId: string,
): Promise<{ profileId: string; permission?: PermissionChoice } | null> {
  const app = useAppStore.getState()
  if (isCleanupBlocked()) {
    app.showToast('正在清理分身资源，请稍后再启动', 'error')
    return null
  }
  const extra = app.settings.customAgents ?? []
  const agent = agentById(tool, extra)
  const name = agent?.name ?? tool
  const api = window.ringcode
  if (!agent) {
    app.showToast(`未找到入口 ${tool}`, 'error')
    return null
  }
  const profile = app.getProfileForTool(tool, workspaceId)
  const requireCredential = isCloneAgent(agent)
  let credentialPresent = !requireCredential
  if (requireCredential) {
    if (api && profile?.credentialRef) credentialPresent = await api.credHas(profile.credentialRef)
    else credentialPresent = !!profile?.credentialSet
  }
  const prepared = await prepareAgentLaunch(
    {
      agent,
      workspace: { path: cwd },
      profile,
      permissionByAgent: app.settings.launchPermissionByAgent ?? {},
      runtimeAvailable: !!api,
      requireCredential,
      credentialPresent,
    },
    (command) => api!.envWhich(command),
  )
  if (!prepared.ok) {
    if (prepared.openSettings) app.openSettings(prepared.settingsTab === 'keys' ? 'keys' : 'profiles', profile?.id)
    if (prepared.reason === 'workspace') app.showToast('请先打开工作区', 'error')
    else if (prepared.reason === 'profile') app.showToast(`请先配置 ${name} 的启动方案`, 'error')
    else if (prepared.reason === 'executable') app.showToast(`未找到 ${profile?.command || name}`, 'error')
    else if (prepared.reason === 'credential') app.showToast(`分身 ${name} 尚未配置 API Key，请先补全密钥`, 'error')
    else app.showToast('当前环境无法启动本地 CLI', 'error')
    return null
  }
  return { profileId: prepared.profileId, permission: prepared.permission }
}
