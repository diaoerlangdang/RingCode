import { useEffect, useState } from 'react'
import { useAppStore, uid } from '@/store/useAppStore'
import { listAgents, seedProfilesFromAgents } from '@/lib/agents'
import { permissionChoicesFor, resolveLaunchPermission } from '@/lib/agentLaunch'
import { DEFAULT_KEYMAP } from '@/lib/keymap'
import { getCommands } from '@/lib/commands'
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
    } else {
      showToast('保存失败', 'error')
    }
  }

  const clearKey = async (tool: string) => {
    const api = window.ringcode
    const p = getProfileForTool(tool)
    if (!api || !p?.credentialRef) return
    await api.credDelete(p.credentialRef)
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
      for (const p of data.profiles) {
        if (!p || typeof p !== 'object' || !p.tool) continue
        upsertProfile({ ...p, id: uid(), modelMode: p.modelMode === 'custom' ? 'custom' : 'default', credentialSet: false })
        n++
      }
      if (Array.isArray(data.customAgents)) {
        setCustomAgents([...(extra ?? []), ...data.customAgents.filter((a: AgentDef) => a?.id && !agents.some((x) => x.id === a.id))])
      }
      showToast(`已导入 ${n} 个配置方案（敏感凭据需重新设置）`, 'success')
    } catch (e) {
      showToast('导入失败：' + (e as Error).message, 'error')
    }
  }

  const editing = profiles.find((p) => p.id === editingId) ?? profiles[0] ?? null
  const editingAgent = editing ? agents.find((agent) => agent.id === editing.tool) : undefined

  const patchProfile = (patch: Partial<ToolProfile>) => {
    if (!editing) return
    upsertProfile({ ...editing, ...patch })
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
            <div className="settings-row" style={{ borderBottom: 'none' }}>
              <div>
                <div className="label">关于</div>
                <div className="desc">金刚琢 RingCode · v0.3.1 · 本地优先的 AI 辅助工作台</div>
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
                {editingAgent?.modelArgs?.length ? (
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
              已内置主流 AI CLI。如需接入其它工具，填入名称与命令即可添加自定义 Agent，将在顶栏、启动栏和历史中可用。
            </div>
            {agents.map((a) => {
              const selectedPermission = resolveLaunchPermission(a, settings.launchPermissionByAgent ?? {})
              return (
                <div key={a.id} className="settings-row">
                  <div>
                    <div className="label">{a.name}</div>
                    <div className="desc">
                      {a.command}
                      {a.shortcutDigit ? ` · Ctrl+Shift+${a.shortcutDigit}` : ''}
                      {extra.some((x) => x.id === a.id) ? ' · 自定义' : ' · 内置'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {a.permission && (
                      <div className="seg" title="直接启动时使用的权限模式">
                        {permissionChoicesFor(a).map((choice) => (
                          <button
                            key={choice}
                            className={`${selectedPermission === choice ? 'active' : ''}${choice === 'dangerous' ? ' danger' : ''}`}
                            onClick={() =>
                              patchSettings({
                                launchPermissionByAgent: {
                                  ...(settings.launchPermissionByAgent ?? {}),
                                  [a.id]: choice,
                                },
                              })
                            }
                          >
                            {choice === 'default' ? '默认' : choice === 'auto' ? 'Auto' : '危险'}
                          </button>
                        ))}
                      </div>
                    )}
                    {extra.some((x) => x.id === a.id) && (
                      <button className="btn danger" onClick={() => setCustomAgents(extra.filter((x) => x.id !== a.id))}>
                        移除
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
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
