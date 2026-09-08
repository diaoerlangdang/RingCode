import { useEffect, useRef, useState } from 'react'
import { useFsStore } from '@/store/useFsStore'
import { useAppStore } from '@/store/useAppStore'
import { useEditorStore } from '@/store/useEditorStore'
import { listDir, writeTextFile, createDirectory, renameEntry, deleteEntry, copyEntry } from '@/lib/fs'
import { runCommand } from '@/lib/commands'
import { loadIgnoreMatcher, ALWAYS_IGNORE, type IgnoreMatcher } from '@/lib/gitignore'
import { isDriveRoot, joinWinPath } from '@/lib/pathWin'
import { quoteForShell } from '@/lib/shellQuote'
import { ptyClient } from '@/lib/ptyClient'
import { getFileCategory } from '@/lib/languages'
import type { FsEntry } from '@/types'

type View = 'grid' | 'list' | 'detail' | 'tree'

export function FileManager() {
  const handle = useFsStore((s) => s.handle)
  const segments = useFsStore((s) => s.segments)
  const rootName = useFsStore((s) => s.rootName)
  const enter = useFsStore((s) => s.enter)
  const up = useFsStore((s) => s.up)
  const goto = useFsStore((s) => s.goto)
  const setFsHandle = useFsStore((s) => s.setHandle)
  const view = useFsStore((s) => s.view)
  const setView = useFsStore((s) => s.setView)
  const touchRecentFile = useAppStore((s) => s.touchRecentFile)
  const workspaces = useAppStore((s) => s.workspaces)
  const addWorkspace = useAppStore((s) => s.addWorkspace)
  const switchWorkspace = useAppStore((s) => s.switchWorkspace)

  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const openFile = useEditorStore((s) => s.openFile)
  const setCenterTopTab = useAppStore((s) => s.setCenterTopTab)
  const showToast = useAppStore((s) => s.showToast)
  const showPrompt = useAppStore((s) => s.showPrompt)
  const showConfirm = useAppStore((s) => s.showConfirm)

  const [entries, setEntries] = useState<FsEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [tick, setTick] = useState(0)
  const [ignoreMatcher, setIgnoreMatcher] = useState<IgnoreMatcher | null>(null)
  const [showIgnored, setShowIgnored] = useState(false)
  const [ctx, setCtx] = useState<{ x: number; y: number; name: string; isDir: boolean } | null>(null)
  const locRef = useRef('')
  const reload = () => setTick((t) => t + 1)

  const locKey =
    (handle.kind === 'electron' ? handle.rootPath : handle.kind) + '|' + segments.join('/')

  useEffect(() => {
    let cancelled = false
    const dirChanged = locRef.current !== locKey
    locRef.current = locKey
    if (dirChanged) setLoading(true)
    listDir(handle, segments)
      .then((es) => {
        if (!cancelled) setEntries(es)
      })
      .catch(() => {
        if (!cancelled) setEntries([])
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [handle, segments, tick, locKey])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onFs = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => reload(), 400)
    }
    window.addEventListener('ringcode:fs-changed', onFs)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('ringcode:fs-changed', onFs)
    }
  }, [])

  // 加载工作区根 .gitignore（FIL-008）
  useEffect(() => {
    let cancelled = false
    loadIgnoreMatcher(handle).then((m) => !cancelled && setIgnoreMatcher(m))
    return () => {
      cancelled = true
    }
  }, [handle, tick])

  // 无工作区：首启引导打开文件夹
  if (!activeWorkspaceId) {
    return (
      <div className="empty-state">
        <div className="emoji">📂</div>
        <div>还没有打开的工作区</div>
        <div style={{ fontSize: 11, marginBottom: 12 }}>打开一个本地文件夹开始工作</div>
        <button className="btn primary" onClick={() => runCommand('workspace.open')}>
          打开文件夹…
        </button>
      </div>
    )
  }

  const breadcrumbParts = [rootName, ...segments]
  const filtered = entries
    .filter((e) => {
      if (ALWAYS_IGNORE.has(e.name)) return false
      if (showIgnored || !ignoreMatcher) return true
      return !ignoreMatcher(e.name, e.isDir)
    })
    .filter((e) => (query ? e.name.toLowerCase().includes(query.toLowerCase()) : true))

  const onOpen = async (e: FsEntry) => {
    if (e.isDir) {
      enter(e.name)
      setSelected(null)
    } else {
      const f = await openFile(handle, [...segments, e.name])
      if (f) {
        setCenterTopTab('editor')
        const ws = workspaces.find((w) => w.id === activeWorkspaceId)
        if (ws) touchRecentFile({ name: e.name, segments: [...segments, e.name], workspaceId: ws.id, workspacePath: ws.path })
        showToast(`已打开 ${e.name}`, 'info')
      } else {
        showToast(`无法打开 ${e.name}`, 'error')
      }
    }
  }

  const newFile = async () => {
    const name = await showPrompt('新建文件名')
    if (!name) return
    try {
      await writeTextFile(handle, [...segments, name], '')
      reload()
      showToast(`已创建 ${name}`, 'success')
    } catch (err) {
      showToast(`创建失败：${(err as Error).message}`, 'error')
    }
  }
  const newFolder = async () => {
    const name = await showPrompt('新建文件夹名')
    if (!name) return
    try {
      await createDirectory(handle, [...segments, name])
      reload()
      showToast(`已创建 ${name}`, 'success')
    } catch (err) {
      showToast(`创建失败：${(err as Error).message}`, 'error')
    }
  }
  const rename = async () => {
    if (!selected) return
    const name = await showPrompt('重命名为', selected)
    if (!name || name === selected) return
    try {
      await renameEntry(handle, [...segments, selected], name)
      setSelected(null)
      reload()
      showToast('已重命名', 'success')
    } catch (err) {
      showToast(`重命名失败：${(err as Error).message}`, 'error')
    }
  }
  const remove = async () => {
    if (!selected) return
    if (!(await showConfirm(`删除「${selected}」？\n将移入回收站。`))) return
    try {
      await deleteEntry(handle, [...segments, selected])
      setSelected(null)
      reload()
      showToast('已删除', 'success')
    } catch (err) {
      showToast(`删除失败：${(err as Error).message}`, 'error')
    }
  }

  const copyPath = async (relative: boolean) => {
    if (!selected) return
    const segs = [...segments, selected]
    const abs =
      handle.kind === 'electron' ? [handle.rootPath, ...segs].join('\\') : segs.join('/')
    const text = relative ? segs.join('/') : abs
    try {
      await navigator.clipboard.writeText(text)
      showToast(relative ? '已复制相对路径' : '已复制绝对路径', 'success')
    } catch {
      showToast(text, 'info')
    }
  }

  const duplicate = async () => {
    if (!selected) return
    const dest = selected.replace(/(\.[^.]+)?$/, (m) => `_copy${m}`)
    try {
      await copyEntry(handle, [...segments, selected], dest)
      reload()
      showToast(`已复制为 ${dest}`, 'success')
    } catch (err) {
      showToast(`复制失败：${(err as Error).message}`, 'error')
    }
  }

  const absOf = (segs: string[]) =>
    handle.kind === 'electron' ? joinWinPath(handle.rootPath, segs) : segs.join('/')

  const startDrag = (e: React.DragEvent, segs: string[]) => {
    const p = absOf(segs)
    e.dataTransfer.setData('application/x-ringcode-path', p)
    e.dataTransfer.setData('text/plain', p)
    e.dataTransfer.effectAllowed = 'copy'
  }

  const sendToAgent = (p: string) => {
    const id = useAppStore.getState().activeTerminalId
    if (!id || !ptyClient.isReal) {
      showToast('请先启动 Agent 或终端，再拖入或插入路径', 'info')
      return
    }
    ptyClient.write(id, quoteForShell(p) + ' ')
    showToast('已把路径插入当前终端', 'success')
  }

  const promoteWorkspace = (segs: string[]) => {
    if (handle.kind !== 'electron') {
      showToast('请在桌面环境打开本地文件夹', 'info')
      return
    }
    const full = joinWinPath(handle.rootPath, segs)
    const name = segs.length ? segs[segs.length - 1] : full.replace(/[\\/]+$/, '') || full
    const existing = workspaces.find((w) => w.path.toLowerCase() === full.toLowerCase())
    if (existing) switchWorkspace(existing.id)
    else addWorkspace(full, name)
    setFsHandle({ kind: 'electron', rootPath: full, name }, name)
    goto([])
    setCenterTopTab('fm')
    showToast(`已设为工作区：${name}`, 'success')
  }

  const selectedEntry = selected ? entries.find((e) => e.name === selected) : undefined
  const browsingDrive = handle.kind === 'electron' && isDriveRoot(handle.rootPath)
  const currentAbs = handle.kind === 'electron' ? joinWinPath(handle.rootPath, segments) : ''

  return (
    <>
      <div className="fm-toolbar">
        <button className="fm-btn" title="上一级" onClick={up} disabled={segments.length === 0}>
          ↑
        </button>
        <button className="fm-btn" title="刷新" onClick={reload}>
          ⟳
        </button>
        <div className="breadcrumb">
          {breadcrumbParts.map((p, i) => (
            <span key={i}>
              {i > 0 && <span className="sep"> › </span>}
              <span
                className={i === breadcrumbParts.length - 1 ? 'cur' : ''}
                style={{ cursor: i === breadcrumbParts.length - 1 ? 'default' : 'pointer' }}
                onClick={() => goto(segments.slice(0, i))}
              >
                {p}
              </span>
            </span>
          ))}
        </div>
        <div className="fm-actions">
          <button className="fm-btn" title="新建文件" onClick={newFile}>
            ＋
          </button>
          <button className="fm-btn" title="新建文件夹" onClick={newFolder}>
            📁
          </button>
          <button className="fm-btn" title="重命名" onClick={rename} disabled={!selected}>
            ✎
          </button>
          <button className="fm-btn" title="删除" onClick={remove} disabled={!selected}>
            🗑
          </button>
          <button className="fm-btn" title="复制" onClick={duplicate} disabled={!selected}>
            ⧉
          </button>
          <button className="fm-btn" title="复制绝对路径" onClick={() => copyPath(false)} disabled={!selected}>
            📍
          </button>
          <button
            className="btn"
            style={{ padding: '3px 8px', fontSize: 11, whiteSpace: 'nowrap' }}
            title={selectedEntry?.isDir ? '将所选文件夹设为工作区' : '将当前文件夹设为工作区'}
            onClick={() => promoteWorkspace(selectedEntry?.isDir ? [...segments, selectedEntry.name] : segments)}
          >
            设为工作区
          </button>
        </div>

        <div className="fm-divider" />

        <div className="fm-view-controls">
          <div className="fm-filter-box">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="过滤…"
              className="fm-filter-input"
              title="按文件名快速过滤当前目录"
            />
            {query && (
              <button className="fm-filter-clear" onClick={() => setQuery('')} title="清除过滤">
                ×
              </button>
            )}
          </div>
          <button
            className={`fm-toggle-btn ${showIgnored ? 'active' : ''} ${!ignoreMatcher ? 'no-rules' : ''}`}
            title={
              ignoreMatcher
                ? showIgnored
                  ? '已显示 .gitignore 忽略项（点击隐藏）'
                  : '已隐藏 .gitignore 忽略项（点击显示）'
                : '当前工作区未检测到 .gitignore 规则（点击查看说明）'
            }
            onClick={() => {
              if (!ignoreMatcher) {
                showToast('当前工作区未检测到 .gitignore 文件，默认已显示全部文件', 'info')
                return
              }
              setShowIgnored((v) => !v)
            }}
          >
            <span className="dot">{showIgnored ? '◉' : '○'}</span>
            <span>忽略项</span>
          </button>
          <div className="view-switch">
            {(['grid', 'list', 'detail', 'tree'] as View[]).map((v) => (
              <button key={v} className={`v ${view === v ? 'active' : ''}`} onClick={() => setView(v)}>
                {v === 'grid' ? '图标' : v === 'list' ? '列表' : v === 'detail' ? '详情' : '树'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {(browsingDrive || segments.length > 0) && handle.kind === 'electron' && (
        <div className="fm-hint">
          {browsingDrive
            ? `正在浏览 ${handle.rootPath}。进入项目文件夹后点「设为工作区」，或顶栏「打开文件夹」。文件可拖到下方 Agent 终端插入路径。`
            : `当前目录：${currentAbs}。可点「设为工作区」，或把文件拖到下方 Agent。`}
        </div>
      )}

      {view === 'tree' ? (
        <div className="fm-tree">
          <FileTreeNode
            handle={handle}
            segments={[]}
            name={rootName}
            isDir
            depth={0}
            ignoreMatcher={showIgnored ? null : ignoreMatcher}
            selectedPath={selected}
            onSelect={(name, segs) => {
              setSelected(name)
              if (segs.length) goto(segs.slice(0, -1))
            }}
            onDragPath={startDrag}
            onOpenFile={async (segs) => {
              const f = await openFile(handle, segs)
              if (f) {
                setCenterTopTab('editor')
                const ws = workspaces.find((w) => w.id === activeWorkspaceId)
                if (ws) {
                  touchRecentFile({
                    name: segs[segs.length - 1],
                    segments: segs,
                    workspaceId: ws.id,
                    workspacePath: ws.path,
                  })
                }
              }
            }}
          />
        </div>
      ) : loading ? (
        <div className="empty-state">
          <div className="emoji">⏳</div>
          <div>读取中…</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="emoji">{query ? '🔍' : '📂'}</div>
          <div>{query ? '当前目录无匹配项' : '此文件夹为空'}</div>
          {!query && handle.kind === 'electron' && (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4, wordBreak: 'break-all' }}>
                {[handle.rootPath, ...segments].join('\\')}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn primary" onClick={() => runCommand('workspace.open')}>
                  打开其他文件夹…
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    const full = [handle.rootPath, ...segments].join('\\')
                    window.ringcode?.revealInExplorer(full)
                  }}
                >
                  在资源管理器中查看
                </button>
              </div>
            </>
          )}
        </div>
      ) : view === 'grid' ? (
        <div className="fm-grid">
          {filtered.map((e) => (
            <div
              key={e.name}
              className={`fm-item ${selected === e.name ? 'sel' : ''}`}
              draggable
              onDragStart={(ev) => startDrag(ev, [...segments, e.name])}
              onClick={() => setSelected(e.name)}
              onDoubleClick={() => onOpen(e)}
              onContextMenu={(ev) => {
                ev.preventDefault()
                setSelected(e.name)
                setCtx({ x: ev.clientX, y: ev.clientY, name: e.name, isDir: e.isDir })
              }}
              title={`${e.name}\n拖到下方终端可插入路径`}
            >
              <TreeItemIcon isDir={e.isDir} open={false} name={e.name} size="lg" />
              <div className="fm-name">{e.name}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="fm-list">
          <div className="fm-list-head">
            <span>名称</span>
            <span>类型</span>
            <span>大小</span>
          </div>
          {filtered.map((e) => (
            <div
              key={e.name}
              className={`fm-list-row ${selected === e.name ? 'sel' : ''}`}
              draggable
              onDragStart={(ev) => startDrag(ev, [...segments, e.name])}
              onClick={() => setSelected(e.name)}
              onDoubleClick={() => onOpen(e)}
              onContextMenu={(ev) => {
                ev.preventDefault()
                setSelected(e.name)
                setCtx({ x: ev.clientX, y: ev.clientY, name: e.name, isDir: e.isDir })
              }}
            >
              <span className="name-cell">
                <TreeItemIcon isDir={e.isDir} open={false} name={e.name} />
                {e.name}
              </span>
              <span>{e.isDir ? '文件夹' : '文件'}</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{e.isDir ? '-' : e.size ? `${e.size} B` : ''}</span>
            </div>
          ))}
        </div>
      )}
      {ctx && (
        <>
          <div
            className="ctx-backdrop"
            onClick={() => setCtx(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setCtx(null)
            }}
          />
          <div className="ctx-menu" style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}>
            {ctx.isDir && (
              <button
                className="ctx-item"
                onClick={() => {
                  promoteWorkspace([...segments, ctx.name])
                  setCtx(null)
                }}
              >
                在此打开工作区
              </button>
            )}
            <button
              className="ctx-item"
              onClick={() => {
                sendToAgent(absOf([...segments, ctx.name]))
                setCtx(null)
              }}
            >
              把路径插入当前 Agent
            </button>
            <button
              className="ctx-item"
              onClick={() => {
                void navigator.clipboard.writeText(absOf([...segments, ctx.name]))
                showToast('已复制路径', 'success')
                setCtx(null)
              }}
            >
              复制路径
            </button>
          </div>
        </>
      )}
    </>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`fm-tree-chevron ${open ? 'open' : ''}`}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 3.5l4.5 4.5L6 12.5" />
    </svg>
  )
}

function TreeItemIcon({
  isDir,
  open = false,
  name,
  size = 'sm',
}: {
  isDir: boolean
  open?: boolean
  name: string
  size?: 'sm' | 'lg'
}) {
  const baseClass = size === 'lg' ? 'fm-grid-icon' : 'fm-tree-icon'
  if (isDir) {
    return open ? (
      <svg className={`${baseClass} folder open`} viewBox="0 0 16 16" fill="currentColor">
        <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.086a1.5 1.5 0 0 1 1.06.44l1.414 1.414H13.5A1.5 1.5 0 0 1 15 5.354V6H3.25A1.25 1.25 0 0 0 2.028 7.02l-1.02 4.417A1.5 1.5 0 0 1 1 11V3.5zM2.43 8a.25.25 0 0 1 .244-.195h11.652a.25.25 0 0 1 .244.305l-1.2 5.2a.75.75 0 0 1-.732.59H2.833a.75.75 0 0 1-.732-.91L2.43 8z" />
      </svg>
    ) : (
      <svg className={`${baseClass} folder`} viewBox="0 0 16 16" fill="currentColor">
        <path d="M1.5 2A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H7.707l-1.854-1.854A.5.5 0 0 0 5.5 2h-4z" />
      </svg>
    )
  }

  const category = getFileCategory(name)
  const colorClass = `file-${category}`

  return (
    <svg className={`${baseClass} file ${colorClass}`} viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 1.5A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5V5.414a1.5 1.5 0 0 0-.44-1.06L10.147 1.44A1.5 1.5 0 0 0 9.086 1H4zm0 1h5v3a1 1 0 0 0 1 1h3v7.5a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z" />
      <path d="M5 7.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5zm0 2.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5z" />
    </svg>
  )
}

function FileTreeNode({
  handle,
  segments,
  name,
  isDir,
  depth,
  ignoreMatcher,
  selectedPath,
  onSelect,
  onOpenFile,
  onDragPath,
}: {
  handle: import('@/lib/fs').DirHandle
  segments: string[]
  name: string
  isDir: boolean
  depth: number
  ignoreMatcher: IgnoreMatcher | null
  selectedPath: string | null
  onSelect: (name: string, segs: string[]) => void
  onOpenFile: (segs: string[]) => void
  onDragPath: (e: React.DragEvent, segs: string[]) => void
}) {
  const [open, setOpen] = useState(depth === 0)
  const [children, setChildren] = useState<FsEntry[] | null>(null)

  useEffect(() => {
    if (!isDir || !open) return
    let cancelled = false
    listDir(handle, segments).then((es) => {
      if (cancelled) return
      const next = es.filter((e) => {
        if (ALWAYS_IGNORE.has(e.name)) return false
        if (!ignoreMatcher) return true
        return !ignoreMatcher(e.name, e.isDir)
      })
      setChildren(next)
    })
    return () => {
      cancelled = true
    }
  }, [handle, segments, open, isDir, ignoreMatcher])

  const pathKey = segments.join('/') || name
  const selected = selectedPath === name && (segments.length === 0 || segments[segments.length - 1] === name)

  return (
    <div>
      <div
        className={`fm-tree-row ${selected ? 'sel' : ''}`}
        style={{ paddingLeft: 6 + depth * 16 }}
        draggable={segments.length > 0}
        onDragStart={(ev) => onDragPath(ev, segments)}
        onClick={() => {
          onSelect(name, segments)
          if (isDir) setOpen((v) => !v)
        }}
        onDoubleClick={() => {
          if (!isDir) onOpenFile(segments)
        }}
      >
        {isDir ? (
          <button
            type="button"
            className="fm-tree-twisty"
            title={open ? '折叠' : '展开'}
            onClick={(e) => {
              e.stopPropagation()
              setOpen((v) => !v)
            }}
          >
            <ChevronIcon open={open} />
          </button>
        ) : (
          <span className="fm-tree-spacer" />
        )}
        <TreeItemIcon isDir={isDir} open={open} name={name} />
        <span className="fm-tree-name">{name}</span>
      </div>
      {isDir && open && children && (
        <div>
          {children.map((c) => (
            <FileTreeNode
              key={pathKey + '/' + c.name}
              handle={handle}
              segments={[...segments, c.name]}
              name={c.name}
              isDir={c.isDir}
              depth={depth + 1}
              ignoreMatcher={ignoreMatcher}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onOpenFile={onOpenFile}
              onDragPath={onDragPath}
            />
          ))}
        </div>
      )}
    </div>
  )
}
