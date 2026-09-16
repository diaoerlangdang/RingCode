import { useEffect, useState } from 'react'
import { useAppStore, uid } from '@/store/useAppStore'
import { listAgents, seedProfilesFromAgents } from '@/lib/agents'
import { isCloneAgent, isCloneFamily, cloneableSource } from '@/lib/agentFamily'
import { CloneModelField } from '@/components/CloneModelField'
import {
  createCloneAgent,
  createCloneProfile,
  prepareImportedClone,
  validateCloneCommandName,
  validateCloneDisplayName,
} from '@/lib/agentClone'
import { permissionChoicesFor, resolveCurrentLaunchConfig, resolveLaunchPermission } from '@/lib/agentLaunch'
import { syncCloneResources } from '@/lib/cloneSync'
import { setCleanupGate } from '@/lib/cleanupGate'
import { runningAiTerminals } from '@/lib/runningAi'
import { appendAgentPreference, moveAgentOrder, orderedAgents } from '@/lib/quickLaunch'
import { DEFAULT_KEYMAP } from '@/lib/keymap'
import { getCommands } from '@/lib/commands'
import { showAppUpdate, type AppUpdateResult } from '@/lib/appUpdateEvents'
import type { AgentDef, EnvVar, ThemeMode, ToolProfile } from '@/types'

const inputStyle: React.CSSProperties = {
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: '5px 10px',
  color: 'var(--text)',
  fontSize: 12,
  outline: 'none',
  flex: 1,
  minWidth: 0,
}

export function SettingsModal() {
  const open = useAppStore((s) => s.settingsOpen)
  const setOpen = useAppStore((s) => s.setSettingsOpen)
  const tab = useAppStore((s) => s.settingsTab)
  const settingsProfileId = useAppStore((s) => s.settingsProfileId)
  const openSettings = useAppStore((s) => s.openSettings)
  const settings = useAppStore((s) => s.settings)
  const setTheme = useAppStore((s) => s.setTheme)
  const setDefaultTool = useAppStore((s) => s.setDefaultTool)
  const setShellExe = useAppStore((s) => s.setShellExe)
  const setKeymap = useAppStore((s) => s.setKeymap)
  const patchSettings = useAppStore((s) => s.patchSettings)
  const setCustomAgents = useAppStore((s) => s.setCustomAgents)
  const deleteCloneAgent = useAppStore((s) => s.deleteCloneAgent)
  const showToast = useAppStore((s) => s.showToast)
  const profiles = useAppStore((s) => s.profiles)
  const upsertProfile = useAppStore((s) => s.upsertProfile)
  const deleteProfile = useAppStore((s) => s.deleteProfile)
  const getProfileForTool = useAppStore((s) => s.getProfileForTool)
  const showConfirm = useAppStore((s) => s.showConfirm)
  const extra = settings.customAgents ?? []
  const agents = listAgents(extra)

  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({})
  const [setMap, setSetMap] = useState<Record<string, boolean>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newAgentName, setNewAgentName] = useState('')
  const [newAgentCmd, setNewAgentCmd] = useState('')
  const [cloneDraft, setCloneDraft] = useState<{
    sourceId: string
    name: string
    commandName: string
    url: string
    model: string
    key: string
  } | null>(null)
  const [cloneBusy, setCloneBusy] = useState(false)
  const [modelLists, setModelLists] = useState<Record<string, string[]>>({})
  const [modelListBusyKey, setModelListBusyKey] = useState<string | null>(null)
  const [modelListHint, setModelListHint] = useState<Record<string, string>>({})
  const [launcherById, setLauncherById] = useState<Record<string, { ok: boolean; path?: string; reason?: string }>>({})
  const [agentQuery, setAgentQuery] = useState('')
  const [updateRuntime, setUpdateRuntime] = useState<{
    currentVersion: string
    channel: 'portable' | 'installer'
    packaged: boolean
  } | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateResult, setUpdateResult] = useState<AppUpdateResult | null>(null)

  useEffect(() => {
    if (open && tab === 'profiles' && settingsProfileId) setEditingId(settingsProfileId)
  }, [open, tab, settingsProfileId])

  useEffect(() => {
    if (!open) return
    const api = window.ringcode
    if (!api) return
    for (const a of agents) {
      const p = getProfileForTool(a.id)
      if (!p?.credentialRef) continue
      api.credHas(p.credentialRef).then((has) => {
        setSetMap((m) => ({ ...m, [a.id]: !!has }))
        if (has !== p.credentialSet) upsertProfile({ ...p, credentialSet: !!has })
      })
    }
  }, [open, profiles, getProfileForTool, upsertProfile])

  useEffect(() => {
    if (!open || tab !== 'agents') return
    for (const agent of agents) {
      if (isCloneAgent(agent)) void refreshLauncher(agent)
    }
  }, [open, tab, extra])

  useEffect(() => {
    if (!open || tab !== 'general') return
    const api = window.ringcode
    if (!api?.updateRuntime) return
    void api.updateRuntime().then(setUpdateRuntime)
  }, [open, tab])

  if (!open) return null

  const saveKey = async (tool: string, value: string) => {
    const api = window.ringcode
    const p = getProfileForTool(tool)
    if (!api || !p?.credentialRef) {
      showToast('当前环境不支持凭据存储，或该工具未配置凭据引用', 'error')
      return
    }
    if (!value) {
      showToast('请输入密钥', 'error')
      return
    }
    const ok = await api.credSet(p.credentialRef, value)
    if (ok) {
      upsertProfile({ ...p, credentialSet: true })
      setSetMap((m) => ({ ...m, [tool]: true }))
      setKeyDraft((d) => ({ ...d, [tool]: '' }))
      showToast('密钥已保存到系统凭据库', 'success')
      const agent = agents.find((item) => item.id === tool)
      if (agent && isCloneAgent(agent)) void syncClone(agent, { ...p, credentialSet: true })
    } else {
      showToast('保存失败', 'error')
    }
  }

  const clearKey = async (tool: string) => {
    const api = window.ringcode
    const p = getProfileForTool(tool)
    if (!api || !p?.credentialRef) return
    const agent = agents.find((item) => item.id === tool)
    if (isCloneAgent(agent)) {
      if (warnRunning(tool)) return
      if (!(await showConfirm(`清除分身「${agent.name}」的 Key？请同时关闭该分身的外部会话。配置和启动器会保留。`))) return
      setCleanupGate(true)
      try {
        const result = await api.cloneClearKey(tool)
        if (result.reason === 'running') {
          showToast('请先结束该分身在 RingCode 中的终端', 'error')
          return
        }
        if (!result.ok) {
          showToast(`清 Key 未完全成功，可重试。${result.results.filter((item) => !item.ok).map((item) => item.reason).join('；')}`, 'error')
        }
      } finally {
        setCleanupGate(false)
      }
    } else {
      await api.credDelete(p.credentialRef)
    }
    upsertProfile({ ...p, credentialSet: false })
    setSetMap((m) => ({ ...m, [tool]: false }))
    showToast('密钥已清除', 'info')
  }

  const clearData = async () => {
    if (!(await showConfirm('清除本地数据？将重置工作区、会话、配置与布局（不可恢复）。'))) return
    if (window.ringcode?.isElectron) await window.ringcode.storeDel('ringcode-store')
    else localStorage.removeItem('ringcode-store')
    window.location.reload()
  }

  const exportProfiles = async () => {
    const api = window.ringcode
    if (!api) {
      showToast('需要桌面环境', 'error')
      return
    }
    const safe = profiles.map((p) => ({
      ...p,
      envs: p.envs.map((e) => (e.sensitive ? { ...e, value: '' } : e)),
    }))
    const data = JSON.stringify(
      { type: 'ringcode-profiles', version: 1, exportedAt: new Date().toISOString(), profiles: safe, customAgents: extra },
      null,
      2,
    )
    const out = await api.saveTextFile('ringcode-profiles.json', data)
    if (out) showToast(`已导出 ${profiles.length} 个配置方案（不含密钥）`, 'success')
  }

  const importProfiles = async () => {
    const api = window.ringcode
    if (!api) {
      showToast('需要桌面环境', 'error')
      return
    }
    const res = await api.openTextFile()
    if (!res) return
    try {
      const data = JSON.parse(res.content)
      if (data.type !== 'ringcode-profiles' || !Array.isArray(data.profiles)) {
        throw new Error('文件格式不正确')
      }
      let n = 0
      const incomingAgents: AgentDef[] = Array.isArray(data.customAgents) ? data.customAgents : []
      const nextAgents = [...(extra ?? [])]
      const importedCloneOldIds = new Set<string>()
      const importedIds: string[] = []
      for (const raw of incomingAgents) {
        if (!raw?.id) continue
        if (isCloneAgent(raw)) {
          const rawProfile = (data.profiles as ToolProfile[]).find((item) => item.tool === raw.id)
          const prepared = prepareImportedClone(raw, rawProfile, {
            agents: listAgents(nextAgents),
            profiles,
            newId: globalThis.crypto?.randomUUID?.() ?? uid(),
          })
          if (!prepared.ok) {
            showToast(`跳过分身 ${raw.name ?? raw.id}：${prepared.message}`, 'error')
            continue
          }
          importedCloneOldIds.add(raw.id)
          nextAgents.push(prepared.agent)
          importedIds.push(prepared.agent.id)
          upsertProfile(prepared.profile)
          void syncClone(prepared.agent, prepared.profile)
          n++
          continue
        }
        if (!nextAgents.some((item) => item.id === raw.id) && !agents.some((item) => item.id === raw.id)) {
          nextAgents.push(raw)
          importedIds.push(raw.id)
        }
      }
      setCustomAgents(nextAgents)
      if (importedIds.length) {
        let prefs = useAppStore.getState().settings.quickLaunch
        const listed = listAgents(nextAgents)
        for (const id of importedIds) prefs = appendAgentPreference(prefs, listed, id)
        patchSettings({ quickLaunch: prefs })
      }
      for (const p of data.profiles) {
        if (!p || typeof p !== 'object' || !p.tool) continue
        if (importedCloneOldIds.has(p.tool)) continue
        const foreignCloneRef = typeof p.credentialRef === 'string' && p.credentialRef.startsWith('ringcode:clone:')
        upsertProfile({
          ...p,
          id: uid(),
          modelMode: p.modelMode === 'custom' ? 'custom' : 'default',
          credentialSet: false,
          credentialRef: foreignCloneRef ? undefined : p.credentialRef,
        })
        n++
      }
      showToast(`已导入 ${n} 项（分身使用新身份，敏感凭据需重新设置）`, 'success')
    } catch (e) {
      showToast('导入失败：' + (e as Error).message, 'error')
    }
  }

  const editing = profiles.find((p) => p.id === editingId) ?? profiles[0] ?? null
  const editingAgent = editing ? agents.find((agent) => agent.id === editing.tool) : undefined

  const patchProfile = (patch: Partial<ToolProfile>) => {
    if (!editing) return
    const next = { ...editing, ...patch }
    upsertProfile(next)
    const agent = agents.find((item) => item.id === next.tool)
    if (agent && isCloneAgent(agent)) void syncClone(agent, next)
  }

  const addProfile = (tool: string) => {
    const a = agents.find((x) => x.id === tool)
    const p: ToolProfile = {
      id: uid(),
      name: `新方案 · ${a?.name ?? tool}`,
      scope: 'global',
      tool,
      command: a?.command ?? tool,
      args: '',
      model: a?.defaultModel ?? '',
      modelMode: 'default',
      envs: a?.credentialEnv ? [{ key: a.credentialEnv, value: '', sensitive: true }] : [],
      terminalStrategy: 'new',
      credentialRef: a?.credentialRef,
      credentialSet: false,
    }
    upsertProfile(p)
    setEditingId(p.id)
  }

  const addCustomAgent = () => {
    const name = newAgentName.trim()
    const command = newAgentCmd.trim()
    if (!name || !command) {
      showToast('请填写名称和命令', 'error')
      return
    }
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `agent-${uid()}`
    if (agents.some((a) => a.id === id)) {
      showToast('该 id 已存在', 'error')
      return
    }
    const def: AgentDef = {
      id,
      name,
      command,
      icon: './logo.png',
      accent: 'var(--surface-2)',
      resumeFlag: '--resume',
      historyRoots: [],
    }
    setCustomAgents([...(extra ?? []), def])
    patchSettings({
      quickLaunch: appendAgentPreference(settings.quickLaunch, listAgents([...(extra ?? []), def]), def.id),
    })
    if (!profiles.some((p) => p.tool === id)) {
      upsertProfile({
        id: `pf-${id}-default`,
        name: `默认 · ${name}`,
        scope: 'global',
        tool: id,
        command,
        args: '',
        model: '',
        modelMode: 'default',
        envs: [],
        terminalStrategy: 'new',
      })
    }
    setNewAgentName('')
    setNewAgentCmd('')
    showToast(`已添加 ${name}，可在顶栏启动`, 'success')
  }

  const syncCloneOverlay = async (agent: AgentDef, profile: ToolProfile) => {
    if (agent.sourceFamily !== 'codex') return
    const cfg = resolveCurrentLaunchConfig({
      agent,
      profile,
      permissionByAgent: settings.launchPermissionByAgent ?? {},
    })
    if ('ok' in cfg && cfg.ok === false) return
    if (!('overlay' in cfg) || !cfg.overlay) return
    const result = await window.ringcode?.writeCodexOverlay?.(cfg.overlay)
    if (result && !result.ok) showToast(`Codex profile 未更新：${result.reason}`, 'error')
  }

  const channelText = (channel?: 'portable' | 'installer') => (channel === 'installer' ? '安装版' : '免安装版')

  const checkAppUpdate = async () => {
    const api = window.ringcode
    if (!api?.checkAppUpdate) {
      showToast('检查更新仅桌面版可用', 'error')
      return
    }
    setUpdateBusy(true)
    try {
      const result = await api.checkAppUpdate(true)
      setUpdateRuntime({ currentVersion: result.currentVersion, channel: result.channel, packaged: result.packaged })
      setUpdateResult(result)
      showToast(result.message, result.ok ? (result.newer ? 'info' : 'success') : 'error')
      if (result.newer) showAppUpdate(result)
    } finally {
      setUpdateBusy(false)
    }
  }

  const refreshLauncher = async (agent: AgentDef) => {
    if (!isCloneAgent(agent) || !agent.commandName || !window.ringcode?.cloneLauncherStatus) return
    const status = await window.ringcode.cloneLauncherStatus({ cloneId: agent.id, commandName: agent.commandName })
    setLauncherById((current) => ({ ...current, [agent.id]: { ok: status.ok, path: status.path, reason: status.reason } }))
  }

  const syncClone = async (agent: AgentDef, profile: ToolProfile) => {
    const permission = useAppStore.getState().settings.launchPermissionByAgent?.[agent.id]
    const result = await syncCloneResources(agent, profile, permission)
    setLauncherById((current) => ({
      ...current,
      [agent.id]: { ok: result.launcherOk, path: result.launcherPath, reason: result.launcherReason },
    }))
    if (!result.launcherOk) {
      showToast(`系统命令未生成：${result.launcherReason ?? '未知原因'}`, 'error')
    }
    return result
  }

  const warnRunning = (agentId?: string) => {
    const running = runningAiTerminals(useAppStore.getState().terminals, agentId)
    if (!running.length) return false
    const names = running.map((item) => item.title).join('、')
    showToast(`请先结束 RingCode 中的相关终端后再试：${names}`, 'error')
    return true
  }

  const startCopyClone = (source: AgentDef) => {
    if (!cloneableSource(source)) {
      showToast('只能从 Claude Code 或 Codex 原版复制分身', 'error')
      return
    }
    setModelLists((current) => ({ ...current, draft: [] }))
    setModelListHint((current) => ({ ...current, draft: '' }))
    setCloneDraft({
      sourceId: source.id,
      name: `${source.name} 分身`,
      commandName: source.id === 'codex' ? 'cheap-codex' : 'cheap-claude',
      url: '',
      model: '',
      key: '',
    })
  }

  const fetchCloneModels = async (opts: {
    cacheKey: string
    family: string
    baseUrl: string
    apiKey?: string
    credentialRef?: string
  }) => {
    const api = window.ringcode
    if (!api?.cloneListModels) {
      showToast('获取模型列表仅桌面版可用', 'error')
      return
    }
    if (!isCloneFamily(opts.family)) {
      showToast('只能为 Claude 或 Codex 分身获取模型', 'error')
      return
    }
    if (!opts.apiKey?.trim() && !opts.credentialRef) {
      showToast('请先填写 API Key', 'error')
      return
    }
    setModelListBusyKey(opts.cacheKey)
    setModelListHint((current) => ({ ...current, [opts.cacheKey]: '' }))
    try {
      const result = await api.cloneListModels({
        family: opts.family,
        baseUrl: opts.baseUrl,
        apiKey: opts.apiKey,
        credentialRef: opts.credentialRef,
      })
      if (!result.ok) {
        setModelListHint((current) => ({ ...current, [opts.cacheKey]: result.reason }))
        showToast(result.reason, 'error')
        return
      }
      setModelLists((current) => ({ ...current, [opts.cacheKey]: result.models }))
      const hint = `已获取 ${result.models.length} 个模型`
      setModelListHint((current) => ({ ...current, [opts.cacheKey]: hint }))
      showToast(hint, 'success')
    } finally {
      setModelListBusyKey((current) => (current === opts.cacheKey ? null : current))
    }
  }

  const submitClone = async () => {
    if (!cloneDraft || cloneBusy) return
    const source = cloneableSource(agents.find((item) => item.id === cloneDraft.sourceId))
    if (!source) {
      showToast('原版 Agent 不存在', 'error')
      return
    }
    const nameCheck = validateCloneDisplayName(cloneDraft.name)
    if (!nameCheck.ok) {
      showToast(nameCheck.message, 'error')
      return
    }
    const cmdCheck = validateCloneCommandName(cloneDraft.commandName, { agents, profiles })
    if (!cmdCheck.ok) {
      showToast(cmdCheck.message, 'error')
      return
    }
    setCloneBusy(true)
    try {
      const id = globalThis.crypto?.randomUUID?.() ?? uid()
      const def = createCloneAgent(source, { id, name: cloneDraft.name, commandName: cloneDraft.commandName })
      const sourceProfile = getProfileForTool(source.id)
      const profile = createCloneProfile(def, sourceProfile, {
        baseUrl: cloneDraft.url,
        model: cloneDraft.model,
        modelMode: cloneDraft.model.trim() ? 'custom' : 'default',
      })
      setCustomAgents([...(extra ?? []), def])
      upsertProfile(profile)
      patchSettings({
        quickLaunch: appendAgentPreference(settings.quickLaunch, listAgents([...(extra ?? []), def]), def.id),
      })
      const api = window.ringcode
      if (profile.credentialRef) {
        await api?.registerOwnedResource?.({ kind: 'credential', id: profile.credentialRef, cloneId: id })
      }
      if (cloneDraft.key.trim() && profile.credentialRef && api) {
        const ok = await api.credSet(profile.credentialRef, cloneDraft.key.trim())
        if (ok) {
          upsertProfile({ ...profile, credentialSet: true })
          setSetMap((m) => ({ ...m, [id]: true }))
        } else showToast('密钥保存失败，可稍后在「密钥」页补全', 'error')
      }
      await syncClone(def, { ...profile, credentialSet: !!cloneDraft.key.trim() })
      if (def.commandName === 'hjcodex') {
        showToast('命令名 hjcodex 可用，但旧 PowerShell 函数可能优先命中。可用 Get-Command hjcodex -All 诊断，或用完整路径调用。', 'info')
      }
      if (api) {
        const pathTaken = await api.envWhich(def.commandName!)
        if (pathTaken) {
          showToast(`已创建 ${def.name}。PATH 中已有同名命令，系统启动器可能被挡住，可用完整路径调用。`, 'info')
        } else {
          showToast(`已创建分身 ${def.name}（${def.commandName}）。未自动修改 PATH，可打开启动器目录自行加入。`, 'success')
        }
      } else {
        showToast(`已创建分身 ${def.name}`, 'success')
      }
      setCloneDraft(null)
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setCloneBusy(false)
    }
  }

  const patchCloneAgent = (agent: AgentDef, patch: Partial<AgentDef>) => {
    const next = extra.map((item) => (item.id === agent.id ? { ...item, ...patch } : item))
    setCustomAgents(next)
    const updated = next.find((item) => item.id === agent.id)
    const profile = updated ? getProfileForTool(updated.id) : undefined
    if (updated && profile) void syncClone(updated, profile)
  }

  const removeClone = async (agent: AgentDef) => {
    if (warnRunning(agent.id)) return
    if (!(await showConfirm(`删除分身「${agent.name}」？将删除其配置、Key 和本应用所属文件，保留原生历史。请同时关闭该分身的外部会话。`))) return
    setCleanupGate(true)
    try {
      const result = await window.ringcode?.cloneDelete(agent.id)
      if (result?.reason === 'running') {
        showToast('请先结束该分身在 RingCode 中的终端', 'error')
        return
      }
      deleteCloneAgent(agent.id)
      if (result && !result.ok) showToast('分身已从应用移除，但部分文件清理失败，可稍后重试', 'error')
      else showToast('分身已删除。旧会话将回退到原版入口', 'success')
    } finally {
      setCleanupGate(false)
    }
  }

  const clearAllSecrets = async () => {
    if (warnRunning()) return
    if (!(await showConfirm('一键全清 RingCode 凭据和所属启动器/profile 文件？分身设置会保留。请关闭全部相关外部会话。'))) return
    setCleanupGate(true)
    try {
      const result = await window.ringcode?.cloneClearAll()
      if (result?.reason === 'running') {
        showToast('请先结束全部 RingCode AI 终端', 'error')
        return
      }
      for (const profile of useAppStore.getState().profiles) {
        if (profile.credentialRef) upsertProfile({ ...profile, credentialSet: false })
      }
      setSetMap({})
      if (result && !result.ok) showToast('全清部分失败，可重试。未宣告成功。', 'error')
      else showToast('已清除凭据和所属文件。补 Key 后将重建启动器。', 'success')
    } finally {
      setCleanupGate(false)
    }
  }

  const keymap = { ...DEFAULT_KEYMAP, ...(settings.keymap ?? {}) }
  const commands = getCommands().filter((c) => c.id !== 'view.theme')

  return (
    <div className="settings-overlay" onClick={() => setOpen(false)}>
      <div className="settings-modal" style={{ width: 720 }} onClick={(e) => e.stopPropagation()}>
        <h3>设置</h3>
        <div className="filter-row" style={{ marginBottom: 12 }}>
          {(
            [
              ['general', '常规'],
              ['profiles', '配置方案'],
              ['agents', 'Agent'],
              ['keys', '密钥与快捷键'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={`chip ${tab === k ? 'active' : ''}`} onClick={() => openSettings(k)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'general' && (
          <>
            <div className="settings-row">
              <div>
                <div className="label">主题</div>
                <div className="desc">深色 / 浅色 / 跟随系统</div>
              </div>
              <div className="seg">
                {(['dark', 'light', 'system'] as ThemeMode[]).map((t) => (
                  <button key={t} className={settings.theme === t ? 'active' : ''} onClick={() => setTheme(t)}>
                    {t === 'dark' ? '深色' : t === 'light' ? '浅色' : '系统'}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-row">
              <div>
                <div className="label">默认 AI 工具</div>
                <div className="desc">未指定时的默认 Agent</div>
              </div>
              <div className="seg" style={{ flexWrap: 'wrap' }}>
                {agents.map((t) => (
                  <button key={t.id} className={settings.defaultTool === t.id ? 'active' : ''} onClick={() => setDefaultTool(t.id)}>
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-row">
              <div>
                <div className="label">终端 Shell</div>
                <div className="desc">新建普通终端时使用的程序</div>
              </div>
              <div className="seg">
                {['powershell.exe', 'cmd.exe', 'bash.exe'].map((exe) => (
                  <button key={exe} className={(settings.shellExe || 'powershell.exe') === exe ? 'active' : ''} onClick={() => setShellExe(exe)}>
                    {exe.replace('.exe', '')}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-row">
              <div>
                <div className="label">保存会话正文</div>
                <div className="desc">关闭后仅保存元数据</div>
              </div>
              <div className="seg">
                <button className={settings.saveTranscript ? 'active' : ''} onClick={() => useAppStore.setState((s) => ({ settings: { ...s.settings, saveTranscript: true } }))}>
                  开启
                </button>
                <button className={!settings.saveTranscript ? 'active' : ''} onClick={() => useAppStore.setState((s) => ({ settings: { ...s.settings, saveTranscript: false } }))}>
                  关闭
                </button>
              </div>
            </div>
            <div className="settings-row">
              <div>
                <div className="label">本地数据</div>
                <div className="desc">工作区、会话、配置与布局</div>
              </div>
              <button className="btn danger" onClick={clearData}>
                清除本地数据
              </button>
            </div>
            <div className="settings-row">
              <div>
                <div className="label">凭据与所属文件</div>
                <div className="desc">全清删除 RingCode 凭据及本应用启动器/Codex profile，保留分身设置。请先结束全部 AI 终端并关闭外部会话。</div>
              </div>
              <button className="btn danger" onClick={() => void clearAllSecrets()}>
                一键全清
              </button>
            </div>
            <div className="settings-row" style={{ borderBottom: 'none' }}>
              <div>
                <div className="label">关于与更新</div>
                <div className="desc">
                  金刚琢 RingCode · v{updateRuntime?.currentVersion ?? '0.4.2'} · {channelText(updateRuntime?.channel)}
                  {updateRuntime && !updateRuntime.packaged ? '（开发态按免安装提示）' : ''}
                </div>
                {updateResult && (
                  <div className="desc" style={{ marginTop: 6 }}>
                    {updateResult.message}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button className="btn" disabled={updateBusy} onClick={() => void checkAppUpdate()}>
                  {updateBusy ? '检查中…' : '检查更新'}
                </button>
                {updateResult?.newer && (
                  <button className="btn primary" onClick={() => showAppUpdate(updateResult)}>
                    查看升级详情
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {tab === 'profiles' && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              {profiles.map((p) => (
                <button key={p.id} className={`chip ${editing?.id === p.id ? 'active' : ''}`} onClick={() => setEditingId(p.id)}>
                  {p.name}
                </button>
              ))}
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) addProfile(e.target.value)
                  e.target.value = ''
                }}
                style={{ ...inputStyle, flex: 'none', width: 140 }}
              >
                <option value="">＋ 新建方案…</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            {editing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label className="settings-field">
                  名称
                  <input style={inputStyle} value={editing.name} onChange={(e) => patchProfile({ name: e.target.value })} />
                </label>
                <label className="settings-field">
                  可执行文件
                  <span style={{ display: 'flex', gap: 6, width: '100%' }}>
                    <input style={inputStyle} value={editing.command} onChange={(e) => patchProfile({ command: e.target.value })} />
                    <button
                      className="btn"
                      onClick={async () => {
                        const p = await window.ringcode?.openExeDialog?.()
                        if (p) patchProfile({ command: p })
                      }}
                    >
                      浏览…
                    </button>
                  </span>
                </label>
                <label className="settings-field">
                  参数
                  <input style={inputStyle} value={editing.args} onChange={(e) => patchProfile({ args: e.target.value })} placeholder='例如 --model sonnet' />
                </label>
                {editingAgent?.modelArgs?.length && !isCloneAgent(editingAgent) ? (
                  <>
                    <label className="settings-field">
                      模型策略
                      <select
                        style={inputStyle}
                        value={editing.modelMode ?? 'default'}
                        onChange={(e) => patchProfile({ modelMode: e.target.value as ToolProfile['modelMode'] })}
                      >
                        <option value="default">跟随 CLI 默认模型</option>
                        <option value="custom">指定模型</option>
                      </select>
                    </label>
                    {editing.modelMode === 'custom' && (
                      <label className="settings-field">
                        模型
                        <input
                          style={inputStyle}
                          value={editing.model}
                          onChange={(e) => patchProfile({ model: e.target.value })}
                          placeholder={editing.tool === 'opencode' ? '例如 anthropic/claude-sonnet-4-5' : '模型 ID'}
                        />
                      </label>
                    )}
                  </>
                ) : null}
                {editingAgent && isCloneAgent(editingAgent) && (
                  <>
                    <label className="settings-field">
                      显示名
                      <input
                        style={inputStyle}
                        value={editingAgent.name}
                        onChange={(e) => patchCloneAgent(editingAgent, { name: e.target.value })}
                      />
                    </label>
                    <label className="settings-field">
                      命令名
                      <input style={inputStyle} value={editingAgent.commandName ?? ''} disabled />
                    </label>
                    <label className="settings-field">
                      API URL
                      <input
                        style={inputStyle}
                        value={editing.baseUrl ?? ''}
                        onChange={(e) => {
                          patchProfile({ baseUrl: e.target.value })
                          setModelLists((current) => ({ ...current, [editing.tool]: [] }))
                          setModelListHint((current) => ({ ...current, [editing.tool]: '' }))
                        }}
                        placeholder="留空则走官方线路"
                      />
                    </label>
                    <CloneModelField
                      inputStyle={inputStyle}
                      listId={`clone-models-${editing.tool}`}
                      value={editing.model}
                      models={modelLists[editing.tool] ?? []}
                      busy={modelListBusyKey === editing.tool}
                      hint={
                        modelListHint[editing.tool] ||
                        (!(setMap[editing.tool] ?? editing.credentialSet) ? '获取列表请先在「密钥」页保存 Key' : '')
                      }
                      fetchDisabled={!editing.credentialRef || !(setMap[editing.tool] ?? editing.credentialSet)}
                      onChange={(model) =>
                        patchProfile({
                          model,
                          modelMode: model.trim() ? 'custom' : 'default',
                        })
                      }
                      onFetch={() =>
                        void fetchCloneModels({
                          cacheKey: editing.tool,
                          family: editingAgent.sourceFamily,
                          baseUrl: editing.baseUrl ?? '',
                          credentialRef: editing.credentialRef,
                        })
                      }
                    />
                  </>
                )}
                <label className="settings-field">
                  终端策略
                  <select
                    style={inputStyle}
                    value={editing.terminalStrategy}
                    onChange={(e) => patchProfile({ terminalStrategy: e.target.value as ToolProfile['terminalStrategy'] })}
                  >
                    <option value="new">每次新建终端</option>
                    <option value="reuse-idle">复用空闲终端</option>
                  </select>
                </label>
                <div className="label" style={{ marginTop: 6 }}>
                  环境变量（非敏感值可写在此；密钥走凭据库）
                </div>
                {editing.envs.map((e, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6 }}>
                    <input
                      style={inputStyle}
                      placeholder="KEY"
                      value={e.key}
                      onChange={(ev) => {
                        const envs = editing.envs.slice()
                        envs[i] = { ...e, key: ev.target.value }
                        patchProfile({ envs })
                      }}
                    />
                    <input
                      style={inputStyle}
                      placeholder={e.sensitive ? '敏感值请用密钥页' : 'value'}
                      value={e.sensitive ? '' : e.value}
                      disabled={e.sensitive}
                      onChange={(ev) => {
                        const envs = editing.envs.slice()
                        envs[i] = { ...e, value: ev.target.value }
                        patchProfile({ envs })
                      }}
                    />
                    <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={!!e.sensitive}
                        onChange={(ev) => {
                          const envs = editing.envs.slice()
                          envs[i] = { ...e, sensitive: ev.target.checked, value: ev.target.checked ? '' : e.value }
                          patchProfile({ envs })
                        }}
                      />
                      敏感
                    </label>
                    <button
                      className="btn"
                      onClick={() => patchProfile({ envs: editing.envs.filter((_, j) => j !== i) })}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  className="btn"
                  onClick={() => patchProfile({ envs: [...editing.envs, { key: '', value: '', sensitive: false } as EnvVar] })}
                >
                  ＋ 环境变量
                </button>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn" onClick={exportProfiles}>
                    导出全部
                  </button>
                  <button className="btn" onClick={importProfiles}>
                    导入
                  </button>
                  {!seedProfilesFromAgents().some((p) => p.id === editing.id) && (
                    <button
                      className="btn danger"
                      onClick={async () => {
                        if (await showConfirm(`删除配置方案「${editing.name}」？`)) {
                          deleteProfile(editing.id)
                          setEditingId(null)
                        }
                      }}
                    >
                      删除此方案
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>暂无配置方案</div>
            )}
          </>
        )}

        {tab === 'agents' && (
          <>
            <div className="desc" style={{ marginBottom: 10 }}>
              可从 Claude Code / Codex 复制分身。隐藏后不出现在顶部快速启动区，仍可通过历史、命令面板和快捷键使用。系统命令生成在 %USERPROFILE%\.ringcode\bin，不自动改 PATH。
            </div>
            <div className="search-box" style={{ marginBottom: 10 }}>
              <span aria-hidden="true">⌕</span>
              <input value={agentQuery} onChange={(e) => setAgentQuery(e.target.value)} placeholder="搜索 Agent 显示名 / 命令名" />
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => void window.ringcode?.cloneOpenBin?.()}>
                打开启动器目录
              </button>
              <button
                className="btn"
                onClick={() => patchSettings({ quickLaunch: { hiddenAgentIds: [], agentOrder: [] } })}
              >
                恢复默认显示与顺序
              </button>
            </div>
            {orderedAgents(agents, settings.quickLaunch)
              .filter((a) => {
                const q = agentQuery.trim().toLowerCase()
                if (!q) return true
                return `${a.name}\n${a.command}\n${a.commandName ?? ''}`.toLowerCase().includes(q)
              })
              .map((a) => {
              const selectedPermission = resolveLaunchPermission(a, settings.launchPermissionByAgent ?? {})
              const clone = isCloneAgent(a)
              const profile = getProfileForTool(a.id)
              const hidden = (settings.quickLaunch?.hiddenAgentIds ?? []).includes(a.id)
              const order = orderedAgents(agents, settings.quickLaunch).map((item) => item.id)
              const launcher = launcherById[a.id]
              return (
                <div key={a.id} className="settings-row">
                  <div>
                    <div className="label">{a.name}</div>
                    <div className="desc">
                      {clone ? `${a.commandName} · 分身自 ${a.sourceFamily}` : a.command}
                      {a.shortcutDigit ? ` · Ctrl+Shift+${a.shortcutDigit}` : ''}
                      {clone ? '' : extra.some((x) => x.id === a.id) ? ' · 自定义' : ' · 内置'}
                    </div>
                    {clone ? (
                      <div className="desc">
                        {launcher?.ok
                          ? `系统命令已生成：${launcher.path}`
                          : `系统命令未生成${launcher?.reason ? `：${launcher.reason}` : ''}`}
                      </div>
                    ) : null}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <label className="desc" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={!hidden}
                        onChange={() => {
                          const hiddenAgentIds = hidden
                            ? (settings.quickLaunch?.hiddenAgentIds ?? []).filter((id) => id !== a.id)
                            : [...(settings.quickLaunch?.hiddenAgentIds ?? []), a.id]
                          patchSettings({ quickLaunch: { hiddenAgentIds, agentOrder: settings.quickLaunch?.agentOrder ?? order } })
                        }}
                      />
                      快速启动中显示
                    </label>
                    <button
                      className="btn"
                      disabled={order[0] === a.id}
                      onClick={() =>
                        patchSettings({
                          quickLaunch: {
                            hiddenAgentIds: settings.quickLaunch?.hiddenAgentIds ?? [],
                            agentOrder: moveAgentOrder(order, a.id, -1),
                          },
                        })
                      }
                    >
                      上移
                    </button>
                    <button
                      className="btn"
                      disabled={order[order.length - 1] === a.id}
                      onClick={() =>
                        patchSettings({
                          quickLaunch: {
                            hiddenAgentIds: settings.quickLaunch?.hiddenAgentIds ?? [],
                            agentOrder: moveAgentOrder(order, a.id, 1),
                          },
                        })
                      }
                    >
                      下移
                    </button>
                    {a.permission && (
                      <div className="seg" title="直接启动时使用的权限模式">
                        {permissionChoicesFor(a).map((choice) => (
                          <button
                            key={choice}
                            className={`${selectedPermission === choice ? 'active' : ''}${choice === 'dangerous' ? ' danger' : ''}`}
                            onClick={() => {
                              patchSettings({
                                launchPermissionByAgent: {
                                  ...(settings.launchPermissionByAgent ?? {}),
                                  [a.id]: choice,
                                },
                              })
                              if (clone && profile) void syncClone(a, profile)
                            }}
                          >
                            {choice === 'default' ? '默认' : choice === 'auto' ? 'Auto' : '危险'}
                          </button>
                        ))}
                      </div>
                    )}
                    {cloneableSource(a) && (
                      <button className="btn" onClick={() => startCopyClone(a)}>
                        复制分身
                      </button>
                    )}
                    {clone && profile && (
                      <button className="btn" onClick={() => openSettings('profiles', profile.id)}>
                        编辑配置
                      </button>
                    )}
                    {clone && (
                      <button className="btn" onClick={() => { if (profile) void syncClone(a, profile) }}>
                        重试生成命令
                      </button>
                    )}
                    {clone && profile?.credentialSet && (
                      <button className="btn" onClick={() => void clearKey(a.id)}>
                        清 Key
                      </button>
                    )}
                    {clone && (
                      <button className="btn danger" onClick={() => void removeClone(a)}>
                        删除分身
                      </button>
                    )}
                    {extra.some((x) => x.id === a.id) && !clone && (
                      <button className="btn danger" onClick={() => setCustomAgents(extra.filter((x) => x.id !== a.id))}>
                        移除
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
            {cloneDraft && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="label">复制 {agents.find((item) => item.id === cloneDraft.sourceId)?.name} 分身</div>
                <div className="desc">显示名和命令名必填。Key、URL、模型可后补。命令名创建后不可改。</div>
                <label className="settings-field">
                  显示名
                  <input style={inputStyle} value={cloneDraft.name} onChange={(e) => setCloneDraft({ ...cloneDraft, name: e.target.value })} />
                </label>
                <label className="settings-field">
                  命令名
                  <input style={inputStyle} value={cloneDraft.commandName} onChange={(e) => setCloneDraft({ ...cloneDraft, commandName: e.target.value.toLowerCase() })} placeholder="cheap-codex" />
                </label>
                <label className="settings-field">
                  API URL（选填）
                  <input
                    style={inputStyle}
                    value={cloneDraft.url}
                    onChange={(e) => {
                      setCloneDraft({ ...cloneDraft, url: e.target.value })
                      setModelLists((current) => ({ ...current, draft: [] }))
                      setModelListHint((current) => ({ ...current, draft: '' }))
                    }}
                    placeholder="留空则走官方线路"
                  />
                </label>
                <label className="settings-field">
                  API Key（选填）
                  <input type="password" style={inputStyle} value={cloneDraft.key} onChange={(e) => setCloneDraft({ ...cloneDraft, key: e.target.value })} placeholder="可后补；获取模型列表需要 Key" />
                </label>
                <CloneModelField
                  inputStyle={inputStyle}
                  listId="clone-models-draft"
                  value={cloneDraft.model}
                  models={modelLists.draft ?? []}
                  busy={modelListBusyKey === 'draft'}
                  hint={modelListHint.draft || (!cloneDraft.key.trim() ? '获取列表请先填写 API Key' : '')}
                  fetchDisabled={!cloneDraft.key.trim()}
                  onChange={(model) => setCloneDraft({ ...cloneDraft, model })}
                  onFetch={() =>
                    void fetchCloneModels({
                      cacheKey: 'draft',
                      family: cloneDraft.sourceId,
                      baseUrl: cloneDraft.url,
                      apiKey: cloneDraft.key,
                    })
                  }
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn primary" disabled={cloneBusy} onClick={() => void submitClone()}>
                    {cloneBusy ? '创建中…' : '创建分身'}
                  </button>
                  <button className="btn" onClick={() => setCloneDraft(null)}>
                    取消
                  </button>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input style={inputStyle} placeholder="名称，如 Cursor Agent" value={newAgentName} onChange={(e) => setNewAgentName(e.target.value)} />
              <input style={inputStyle} placeholder="命令，如 cursor-agent" value={newAgentCmd} onChange={(e) => setNewAgentCmd(e.target.value)} />
              <button className="btn primary" onClick={addCustomAgent}>
                添加
              </button>
            </div>
          </>
        )}

        {tab === 'keys' && (
          <>
            <div className="label">API 密钥</div>
            <div className="desc" style={{ marginBottom: 8 }}>
              存入 Windows 凭据管理器，配置中不留明文
            </div>
            {agents
              .filter((a) => getProfileForTool(a.id)?.credentialRef)
              .map((a) => {
                const p = getProfileForTool(a.id)
                const isSet = setMap[a.id] ?? p?.credentialSet ?? false
                return (
                  <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%', marginBottom: 8 }}>
                    <span style={{ width: 88, fontSize: 12, color: 'var(--text-2)' }}>{a.name}</span>
                    <input
                      type="password"
                      placeholder={isSet ? '••••••（已设置，输入可替换）' : '输入 API Key'}
                      value={keyDraft[a.id] ?? ''}
                      onChange={(e) => setKeyDraft((d) => ({ ...d, [a.id]: e.target.value }))}
                      style={inputStyle}
                    />
                    <span style={{ fontSize: 11, color: isSet ? 'var(--success)' : 'var(--text-3)', width: 44 }}>
                      {isSet ? '已设置' : '未设置'}
                    </span>
                    <button className="btn" onClick={() => saveKey(a.id, keyDraft[a.id] ?? '')}>
                      保存
                    </button>
                    {isSet && (
                      <button className="btn" onClick={() => clearKey(a.id)}>
                        清除
                      </button>
                    )}
                  </div>
                )
              })}
            <div className="label" style={{ marginTop: 16 }}>
              快捷键
            </div>
            <div className="desc" style={{ marginBottom: 8 }}>
              填写如 Ctrl+Shift+1。主题切换仍为 Ctrl+K 然后 Ctrl+T。
            </div>
            {commands
              .filter((c) => DEFAULT_KEYMAP[c.id] || keymap[c.id])
              .map((c) => (
                <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ flex: 1, fontSize: 12 }}>{c.label}</span>
                  <input
                    style={{ ...inputStyle, flex: 'none', width: 160 }}
                    value={keymap[c.id] ?? ''}
                    onChange={(e) => setKeymap({ ...(settings.keymap ?? {}), [c.id]: e.target.value })}
                  />
                </div>
              ))}
          </>
        )}

        <div className="modal-actions">
          <button className="btn primary" onClick={() => setOpen(false)}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
