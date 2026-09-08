// 首启向导：检测已注册 Agent CLI 并引导打开工作区
import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { BUILTIN_AGENTS } from '@/lib/agents'

export function FirstRunWizard() {
  const open = useAppStore((s) => s.wizardOpen)
  const firstRunDone = useAppStore((s) => s.settings.firstRunDone)
  const completeFirstRun = useAppStore((s) => s.completeFirstRun)
  const addWorkspace = useAppStore((s) => s.addWorkspace)
  const switchWorkspace = useAppStore((s) => s.switchWorkspace)
  const showToast = useAppStore((s) => s.showToast)

  const [status, setStatus] = useState<Record<string, boolean | null>>({})

  useEffect(() => {
    if (!open) return
    const api = window.ringcode
    const ids = BUILTIN_AGENTS.map((a) => a.id)
    if (!api) {
      setStatus(Object.fromEntries(ids.map((id) => [id, false])))
      return
    }
    let cancelled = false
    Promise.all(BUILTIN_AGENTS.map((a) => api.envWhich(a.command).catch(() => false))).then((rs) => {
      if (cancelled) return
      const next: Record<string, boolean | null> = {}
      BUILTIN_AGENTS.forEach((a, i) => {
        next[a.id] = rs[i]
      })
      setStatus(next)
    })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open || firstRunDone) return null

  const openFolder = async () => {
    const api = window.ringcode
    if (!api) {
      completeFirstRun()
      return
    }
    const p = await api.openDirectoryDialog()
    if (!p) {
      showToast('未选择文件夹，可稍后在顶部打开', 'info')
      completeFirstRun()
      return
    }
    const name = p.split(/[\\/]/).pop() ?? p
    const ws = addWorkspace(p, name)
    switchWorkspace(ws.id)
    showToast(`已打开工作区：${name}`, 'success')
    completeFirstRun()
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 560 }}>
        <h3>欢迎使用 金刚琢</h3>
        <p style={{ fontSize: 12, color: 'var(--text-2)', margin: '0 0 16px' }}>
          一个窗口里完成文件、终端和多个 AI Agent，不必再来回切窗口。已检测以下 CLI：
        </p>
        {BUILTIN_AGENTS.map((c) => {
          const st = status[c.id]
          return (
            <div className="modal-row" key={c.id} style={{ alignItems: 'flex-start' }}>
              <div>
                <div style={{ color: 'var(--text)', fontWeight: 600 }}>{c.name}</div>
                {st === false && c.setupUrl && (
                  <a
                    href={c.setupUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2, display: 'inline-block' }}
                  >
                    查看安装指南 ↗
                  </a>
                )}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {st == null ? (
                  <span style={{ color: 'var(--text-3)', fontSize: 12 }}>检测中…</span>
                ) : st ? (
                  <span style={{ color: 'var(--success)', fontSize: 12 }}>● 已安装</span>
                ) : (
                  <span style={{ color: 'var(--warning)', fontSize: 12 }}>○ 未安装</span>
                )}
              </div>
            </div>
          )
        })}
        <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '12px 0 0' }}>
          安装后在「设置」中配置密钥与可执行文件路径；亦可随时在设置中添加自定义 Agent CLI。
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={completeFirstRun}>
            稍后
          </button>
          <button className="btn primary" onClick={openFolder}>
            打开工作区文件夹
          </button>
        </div>
      </div>
    </div>
  )
}
