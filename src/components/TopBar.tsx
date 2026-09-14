import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { useFsStore } from '@/store/useFsStore'
import { isFsAccessSupported, pickDirectory } from '@/lib/fs'
import { runCommand } from '@/lib/commands'
import { QuickLaunchCluster } from '@/components/QuickLaunchCluster'

export function TopBar() {
  const workspaces = useAppStore((s) => s.workspaces)
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const switchWorkspace = useAppStore((s) => s.switchWorkspace)
  const addWorkspace = useAppStore((s) => s.addWorkspace)
  const openCommandPalette = useAppStore((s) => s.openCommandPalette)
  const openSettings = useAppStore((s) => s.openSettings)
  const showToast = useAppStore((s) => s.showToast)
  const resolveTheme = useAppStore((s) => s.resolveTheme)
  const setTheme = useAppStore((s) => s.setTheme)
  const savedLayouts = useAppStore((s) => s.savedLayouts)
  const saveLayout = useAppStore((s) => s.saveLayout)
  const applySavedLayout = useAppStore((s) => s.applySavedLayout)
  const deleteSavedLayout = useAppStore((s) => s.deleteSavedLayout)

  const setFsHandle = useFsStore((s) => s.setHandle)
  const showPrompt = useAppStore((s) => s.showPrompt)

  const [wsOpen, setWsOpen] = useState(false)
  const [layoutOpen, setLayoutOpen] = useState(false)
  const wsRef = useRef<HTMLDivElement>(null)
  const layoutRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wsRef.current && !wsRef.current.contains(e.target as Node)) setWsOpen(false)
      if (layoutRef.current && !layoutRef.current.contains(e.target as Node)) setLayoutOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [])

  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId)
  const theme = resolveTheme()

  const openFolder = async () => {
    setWsOpen(false)
    if (!isFsAccessSupported()) {
      showToast('当前环境不支持本地目录访问', 'info')
      return
    }
    const h = await pickDirectory()
    if (!h) return
    const name = h.kind === 'mock' ? 'workspace' : h.name
    const path = h.kind === 'electron' ? h.rootPath : h.kind === 'real' ? h.handle.name : name
    addWorkspace(path, name)
    setFsHandle(h, name)
    showToast(`已打开工作区：${name}`, 'success')
  }

  const pickWorkspace = (id: string) => {
    switchWorkspace(id)
    setWsOpen(false)
  }

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark')

  return (
    <div className="topbar">
      <div className="t-btn" ref={wsRef} style={{ position: 'relative' }} onClick={() => setWsOpen((v) => !v)}>
        <span className="t-icon" />
        <span className="t-ws-name">▾ {activeWs?.name ?? '选择工作区'}</span>
        {wsOpen && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              minWidth: 220,
              background: 'var(--surface)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow-modal)',
              padding: 6,
              zIndex: 40,
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', padding: '6px 10px', textTransform: 'uppercase', letterSpacing: 1 }}>
              工作区
            </div>
            {workspaces.map((w) => (
              <div
                key={w.id}
                className="nav-item"
                style={{ margin: 0, borderRadius: 6 }}
                onClick={() => pickWorkspace(w.id)}
              >
                <span className="dot" style={w.id === activeWorkspaceId ? { background: 'var(--accent)', borderColor: 'var(--accent)' } : undefined} />
                {w.name}
              </div>
            ))}
            <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
            <div className="nav-item" style={{ margin: 0, borderRadius: 6 }} onClick={openFolder}>
              <span style={{ width: 14, textAlign: 'center' }}>＋</span>打开文件夹…
            </div>
          </div>
        )}
      </div>

      <div className="t-btn" onClick={() => runCommand('file.search')}>
        <span className="t-icon" />
        搜索内容
      </div>
      <div className="t-btn" onClick={openCommandPalette}>
        <span className="t-icon" />
        命令面板 <span style={{ color: 'var(--text-3)' }}>Ctrl+Shift+P</span>
      </div>

      <div className="t-btn" ref={layoutRef} style={{ position: 'relative' }} onClick={() => setLayoutOpen((v) => !v)}>
        <span className="t-icon" />
        布局 ▾
        {layoutOpen && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              right: 0,
              minWidth: 200,
              background: 'var(--surface)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow-modal)',
              padding: 6,
              zIndex: 40,
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', padding: '6px 10px', textTransform: 'uppercase', letterSpacing: 1 }}>
              布局预设
            </div>
            {savedLayouts.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-3)', padding: '6px 10px' }}>无已保存布局</div>
            )}
            {savedLayouts.map((l) => (
              <div
                key={l.id}
                className="nav-item"
                style={{ margin: 0, borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6 }}
                onClick={(e) => {
                  e.stopPropagation()
                  applySavedLayout(l.id)
                  setLayoutOpen(false)
                  showToast(`已应用布局：${l.name}`, 'success')
                }}
              >
                <span style={{ flex: 1 }}>{l.name}</span>
                <span
                  style={{ color: 'var(--text-3)', padding: '0 4px' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteSavedLayout(l.id)
                  }}
                >
                  ×
                </span>
              </div>
            ))}
            <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
            <div
              className="nav-item"
              style={{ margin: 0, borderRadius: 6 }}
              onClick={async (e) => {
                e.stopPropagation()
                const n = await showPrompt('布局名称（如：编码 / 文档 / 专注终端）')
                if (n && n.trim()) {
                  saveLayout(n.trim())
                  showToast(`已保存布局：${n.trim()}`, 'success')
                }
                setLayoutOpen(false)
              }}
            >
              <span style={{ width: 14, textAlign: 'center' }}>💾</span>保存当前布局…
            </div>
          </div>
        )}
      </div>

      <QuickLaunchCluster onManage={() => openSettings('agents')} />
      <button className="tool-btn" title="设置" aria-label="设置" onClick={() => openSettings()}>
        ⚙
      </button>
      <button className="tool-btn" title={`切换主题（当前：${theme === 'dark' ? '深色' : '浅色'}）`} aria-label="切换主题" onClick={toggleTheme}>
        {theme === 'dark' ? '☾' : '☀'}
      </button>
    </div>
  )
}
