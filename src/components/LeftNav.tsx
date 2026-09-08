import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { useFsStore } from '@/store/useFsStore'
import { useEditorStore } from '@/store/useEditorStore'
import type { RecentFile } from '@/types'

type LeftNavMenu =
  | { kind: 'workspace'; x: number; y: number; wsId: string }
  | { kind: 'recent'; x: number; y: number; file: RecentFile }

export function LeftNav() {
  const workspaces = useAppStore((s) => s.workspaces)
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const switchWorkspace = useAppStore((s) => s.switchWorkspace)
  const addWorkspace = useAppStore((s) => s.addWorkspace)
  const removeWorkspace = useAppStore((s) => s.removeWorkspace)
  const renameWorkspace = useAppStore((s) => s.renameWorkspace)
  const toggleFavoriteWorkspace = useAppStore((s) => s.toggleFavoriteWorkspace)
  const showToast = useAppStore((s) => s.showToast)
  const showPrompt = useAppStore((s) => s.showPrompt)
  const recentFiles = useAppStore((s) => s.recentFiles)
  const removeRecentFile = useAppStore((s) => s.removeRecentFile)
  const setCenterTopTab = useAppStore((s) => s.setCenterTopTab)

  const [drives, setDrives] = useState<string[]>([])
  const [menu, setMenu] = useState<LeftNavMenu | null>(null)

  useEffect(() => {
    let cancelled = false
    const api = window.ringcode
    if (!api?.fsListDrives) return
    api.fsListDrives().then((ds) => !cancelled && setDrives(ds)).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu])

  const openPath = (p: string) => {
    const name = p.replace(/[\\/]+$/, '') || p
    const existing = workspaces.find((w) => w.path.toLowerCase() === p.toLowerCase())
    if (existing) switchWorkspace(existing.id)
    else addWorkspace(p, name)
    setCenterTopTab('fm')
    const isDrive = /^[a-zA-Z]:[\\/]?$/.test(p.trim())
    showToast(
      isDrive
        ? `已浏览 ${name}。进入目标文件夹后，点文件管理器工具栏「设为工作区」`
        : `已打开工作区：${name}`,
      'info',
    )
  }

  const wsOf = (id: string) => workspaces.find((w) => w.id === id)

  const closeWorkspace = () => {
    if (menu?.kind !== 'workspace') return
    removeWorkspace(menu.wsId)
    showToast('已关闭工作区', 'info')
    setMenu(null)
  }

  const revealWorkspace = () => {
    if (menu?.kind !== 'workspace') return
    const ws = wsOf(menu.wsId)
    if (ws) window.ringcode?.revealInExplorer(ws.path)
    setMenu(null)
  }

  const renameWs = async () => {
    if (menu?.kind !== 'workspace') return
    const ws = wsOf(menu.wsId)
    setMenu(null)
    if (!ws) return
    const n = await showPrompt('重命名工作区', ws.name)
    if (n && n.trim()) renameWorkspace(ws.id, n.trim())
  }

  const favWs = () => {
    if (menu?.kind !== 'workspace') return
    toggleFavoriteWorkspace(menu.wsId)
    setMenu(null)
  }

  const removeRecent = () => {
    if (menu?.kind !== 'recent') return
    removeRecentFile(menu.file.workspaceId, menu.file.segments)
    setMenu(null)
    showToast('已从最近列表移除', 'info')
  }

  const favorites = workspaces.filter((w) => w.favorite)

  const openRecent = async (f: (typeof recentFiles)[0]) => {
    const ws = workspaces.find((w) => w.id === f.workspaceId)
    if (ws) switchWorkspace(ws.id)
    else if (f.workspacePath) {
      const existing = workspaces.find((w) => w.path.toLowerCase() === f.workspacePath.toLowerCase())
      if (existing) switchWorkspace(existing.id)
      else addWorkspace(f.workspacePath, f.workspacePath.split(/[\\/]/).pop() || f.workspacePath)
    }
    const handle = useFsStore.getState().handle
    const opened = await useEditorStore.getState().openFile(handle, f.segments)
    if (opened) {
      setCenterTopTab('editor')
    } else {
      showToast('无法打开该文件（工作区可能已变）', 'error')
    }
  }

  return (
    <div className="left" style={{ width: '100%', height: '100%' }}>
      <div className="brand-left">
        <img src="./logo.png" alt="金刚琢" />
        <span>金刚琢</span>
      </div>
      <div className="nav-scroll">
        <div className="nav-group">
          <div className="group-title">工作区</div>
          {workspaces.map((w) => (
            <div
              key={w.id}
              className={`nav-item ${w.id === activeWorkspaceId ? 'active' : ''}`}
              onClick={() => switchWorkspace(w.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ kind: 'workspace', x: e.clientX, y: e.clientY, wsId: w.id })
              }}
              title={w.path}
            >
              <span className="dot" />
              {w.favorite ? '★ ' : ''}
              {w.name}
            </div>
          ))}
          {workspaces.length === 0 && (
            <div className="nav-item" style={{ color: 'var(--text-3)', cursor: 'default' }}>
              尚未打开工作区
            </div>
          )}
        </div>

        <div className="nav-group">
          <div className="group-title">此电脑</div>
          {drives.length === 0 ? (
            <div className="nav-item" style={{ color: 'var(--text-3)', cursor: 'default' }}>
              {window.ringcode ? '未检测到磁盘' : '需桌面环境'}
            </div>
          ) : (
            drives.map((d) => {
              const name = d.replace(/[\\/]+$/, '') || d
              const isActive = workspaces.some(
                (w) => w.path.toLowerCase() === d.toLowerCase() && w.id === activeWorkspaceId,
              )
              return (
                <div
                  key={d}
                  className={`nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => openPath(d)}
                  title={d}
                >
                  <span className="chev">▸</span>
                  {name}
                </div>
              )
            })
          )}
        </div>

        <div className="nav-group">
          <div className="group-title">收藏</div>
          {favorites.length === 0 ? (
            <div className="nav-item" style={{ color: 'var(--text-3)', cursor: 'default' }}>
              右键工作区可收藏
            </div>
          ) : (
            favorites.map((w) => (
              <div
                key={w.id}
                className={`nav-item ${w.id === activeWorkspaceId ? 'active' : ''}`}
                onClick={() => switchWorkspace(w.id)}
              >
                <span className="star">★</span>
                {w.name}
              </div>
            ))
          )}
        </div>

        <div className="nav-group">
          <div className="group-title">最近</div>
          {recentFiles.length === 0 ? (
            <div className="nav-item" style={{ color: 'var(--text-3)', cursor: 'default' }}>
              打开文件后会出现在这里
            </div>
          ) : (
            recentFiles.slice(0, 12).map((f) => (
              <div
                key={`${f.workspaceId}:${f.segments.join('/')}`}
                className="nav-item"
                title={f.segments.join('/')}
                onClick={() => openRecent(f)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ kind: 'recent', x: e.clientX, y: e.clientY, file: f })
                }}
              >
                {f.name}
              </div>
            ))
          )}
        </div>
      </div>

      {menu && (
        <>
          <div
            className="ctx-backdrop"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu(null)
            }}
          />
          <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
            {menu.kind === 'workspace' ? (
              <>
                <button className="ctx-item" onClick={favWs}>
                  {wsOf(menu.wsId)?.favorite ? '取消收藏' : '收藏工作区'}
                </button>
                <button className="ctx-item" onClick={renameWs}>
                  重命名
                </button>
                <button className="ctx-item" onClick={revealWorkspace}>
                  在资源管理器中打开
                </button>
                <button className="ctx-item danger" onClick={closeWorkspace}>
                  关闭工作区
                </button>
              </>
            ) : (
              <button className="ctx-item" onClick={removeRecent} title="不会删除磁盘上的文件">
                从最近列表移除
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
