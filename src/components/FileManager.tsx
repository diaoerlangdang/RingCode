import { useEffect, useRef, useState } from 'react'
import { useFsStore } from '@/store/useFsStore'
import { useAppStore } from '@/store/useAppStore'
import { useEditorStore } from '@/store/useEditorStore'
import { listDir, writeTextFile, createDirectory, renameEntry, deleteEntry, copyEntryTo, moveEntryTo, type DirHandle } from '@/lib/fs'
import { runCommand } from '@/lib/commands'
import { loadIgnoreMatcher, ALWAYS_IGNORE, type IgnoreMatcher } from '@/lib/gitignore'
import { isDriveRoot, joinWinPath } from '@/lib/pathWin'
import { quoteForShell } from '@/lib/shellQuote'
import { ptyClient } from '@/lib/ptyClient'
import { getFileCategory } from '@/lib/languages'
import { isTypingTarget } from '@/hooks/useShortcuts'
import { resolvePasteDestName } from '@/lib/fmPaste'
import type { FsEntry } from '@/types'

type View = 'grid' | 'list' | 'detail' | 'tree'

/** 文件剪贴板：复制/剪切后暂存，粘贴时消费（仅 Electron 支持实际操作） */
interface FmClip {
  root: string // 来源根（electron rootPath），支持跨工作区粘贴
  segs: string[] // 来源目录（不含名称）
  name: string
  isDir: boolean
  cut: boolean
}

/** 右键菜单状态：entry = 某个文件/文件夹，blank = 空白处 */
type CtxMenu =
  | { kind: 'entry'; x: number; y: number; segs: string[]; name: string; isDir: boolean }
  | { kind: 'blank'; x: number; y: number }

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
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const [clip, setClip] = useState<FmClip | null>(null)
  const [treeTick, setTreeTick] = useState(0)
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
      timer = setTimeout(() => {
        reload()
        setTreeTick((t) => t + 1)
      }, 400)
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

  /* ---------------- 文件操作（右键菜单 / 快捷键 / 工具栏共用） ---------------- */

  const rootKeyOf = () => (handle.kind === 'electron' ? handle.rootPath : handle.kind)
  /** 剪切项的路径 key（仅当前根），用于列表/树中半透明标识 */
  const clipPath = clip && clip.cut && clip.root === rootKeyOf() ? [...clip.segs, clip.name].join('/') : null
  const bumpTree = () => setTreeTick((t) => t + 1)

  const doRename = async (segs: string[], name: string) => {
    const newName = await showPrompt('重命名为', name)
    if (!newName || newName === name) return
    try {
      await renameEntry(handle, [...segs, name], newName)
      if (segs.join('/') === segments.join('/')) setSelected(newName)
      reload()
      bumpTree()
      showToast('已重命名', 'success')
    } catch (err) {
      showToast(`重命名失败：${(err as Error).message}`, 'error')
    }
  }

  const doDelete = async (segs: string[], name: string) => {
    if (!(await showConfirm(`删除「${name}」？\n将移入回收站。`))) return
    try {
      await deleteEntry(handle, [...segs, name])
      if (selected === name) setSelected(null)
      // 剪贴板中的剪切项被删除时一并清空
      if (clip && clip.cut && clip.segs.join('/') === segs.join('/') && clip.name === name) setClip(null)
      reload()
      bumpTree()
      showToast('已删除', 'success')
    } catch (err) {
      showToast(`删除失败：${(err as Error).message}`, 'error')
    }
  }

  const doClip = (segs: string[], name: string, isDir: boolean, cut: boolean) => {
    if (handle.kind !== 'electron') {
      showToast('请在桌面环境打开本地文件夹后操作', 'info')
      return
    }
    setClip({ root: handle.rootPath, segs, name, isDir, cut })
    showToast(cut ? `已剪切「${name}」，可粘贴到目标位置` : `已复制「${name}」`, 'success')
  }

  /** 目标目录现有项集合（当前目录直接用 entries，避免重复拉取） */
  const existingNames = async (destSegs: string[]): Promise<Set<string>> => {
    if (destSegs.join('/') === segments.join('/')) return new Set(entries.map((e) => e.name))
    try {
      return new Set((await listDir(handle, destSegs)).map((e) => e.name))
    } catch {
      return new Set()
    }
  }

  /** 粘贴核心：复制可自动改名，剪切遇同名失败。 */
  const pasteCore = async (c: FmClip, destSegs: string[]): Promise<boolean> => {
    const srcHandle: DirHandle = { kind: 'electron', rootPath: c.root, name: c.root }
    const dest = resolvePasteDestName({
      name: c.name,
      isDir: c.isDir,
      existing: await existingNames(destSegs),
      cut: c.cut,
    })
    if (!dest.ok) {
      showToast(dest.reason, 'error')
      return false
    }
    try {
      if (c.cut) await moveEntryTo(srcHandle, [...c.segs, c.name], handle, [...destSegs, dest.destName])
      else await copyEntryTo(srcHandle, [...c.segs, c.name], handle, [...destSegs, dest.destName])
      reload()
      bumpTree()
      showToast(c.cut ? `已移动「${c.name}」` : `已粘贴「${dest.destName}」`, 'success')
      return true
    } catch (err) {
      showToast(`${c.cut ? '移动' : '粘贴'}失败：${(err as Error).message}`, 'error')
      return false
    }
  }

  /** 粘贴剪贴板内容到 destSegs 目录 */
  const pasteInto = async (destSegs: string[]) => {
    if (!clip) {
      showToast('剪贴板为空，先复制或剪切文件/文件夹', 'info')
      return
    }
    if (clip.cut && clip.root === rootKeyOf() && clip.segs.join('/') === destSegs.join('/')) {
      showToast('源位置与目标相同，无需粘贴', 'info')
      return
    }
    const ok = await pasteCore(clip, destSegs)
    if (ok && clip.cut) setClip(null)
  }

  /** 同目录副本（工具栏 ⧉），文件夹也支持 */
  const doDuplicate = async () => {
    if (!selected) return
    const en = entries.find((x) => x.name === selected)
    await pasteCore({ root: rootKeyOf(), segs: segments, name: selected, isDir: !!en?.isDir, cut: false }, segments)
  }

  const selectedRef = useRef(selected)
  const segmentsRef = useRef(segments)
  const entriesRef = useRef(entries)
  const fmKeysRef = useRef({ doRename, doDelete, doClip, pasteInto })
  selectedRef.current = selected
  segmentsRef.current = segments
  entriesRef.current = entries
  fmKeysRef.current = { doRename, doDelete, doClip, pasteInto }

  // 文件管理器快捷键：F2 重命名 / Delete 删除 / Ctrl+C 复制 / Ctrl+X 剪切 / Ctrl+V 粘贴 / Esc 关菜单。
  // FileManager 常驻挂载（靠 display 切换），故需检查 centerTopTab；输入框/编辑器/终端聚焦时让位。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useAppStore.getState()
      if (st.centerTopTab !== 'fm' || st.promptDialog || st.confirmDialog) return
      const key = e.key.toLowerCase()
      if (key === 'escape') {
        setCtx(null)
        return
      }
      if (isTypingTarget(e.target)) return
      const currentSelected = selectedRef.current
      const currentSegments = segmentsRef.current
      const currentEntries = entriesRef.current
      const keys = fmKeysRef.current
      if (key === 'f2' && currentSelected) {
        e.preventDefault()
        void keys.doRename(currentSegments, currentSelected)
      } else if (key === 'delete' && currentSelected) {
        e.preventDefault()
        void keys.doDelete(currentSegments, currentSelected)
      } else if (e.ctrlKey && !e.shiftKey && !e.altKey && key === 'c' && currentSelected) {
        e.preventDefault()
        const en = currentEntries.find((x) => x.name === currentSelected)
        keys.doClip(currentSegments, currentSelected, !!en?.isDir, false)
      } else if (e.ctrlKey && !e.shiftKey && !e.altKey && key === 'x' && currentSelected) {
        e.preventDefault()
        const en = currentEntries.find((x) => x.name === currentSelected)
        keys.doClip(currentSegments, currentSelected, !!en?.isDir, true)
      } else if (e.ctrlKey && !e.shiftKey && !e.altKey && key === 'v') {
        e.preventDefault()
        void keys.pasteInto(currentSegments)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  const copyPath = async (relative: boolean, segs = selected ? [...segments, selected] : null) => {
    if (!segs?.length) return
    const abs = handle.kind === 'electron' ? joinWinPath(handle.rootPath, segs) : segs.join('/')
    const text = relative ? segs.join('/') : abs
    try {
      await navigator.clipboard.writeText(text)
      showToast(relative ? '已复制相对路径' : '已复制绝对路径', 'success')
    } catch {
      showToast(text, 'info')
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
          <button className="fm-btn" title="重命名 (F2)" onClick={() => selected && doRename(segments, selected)} disabled={!selected}>
            ✎
          </button>
          <button className="fm-btn" title="删除 (Delete)" onClick={() => selected && doDelete(segments, selected)} disabled={!selected}>
            🗑
          </button>
          <button className="fm-btn" title="在当前目录创建副本" onClick={() => void doDuplicate()} disabled={!selected}>
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
        <div
          className="fm-tree"
          onContextMenu={(ev) => {
            ev.preventDefault()
            setCtx({ kind: 'blank', x: ev.clientX, y: ev.clientY })
          }}
        >
          <FileTreeNode
            handle={handle}
            segments={[]}
            name={rootName}
            isDir
            depth={0}
            ignoreMatcher={showIgnored ? null : ignoreMatcher}
            selectedPath={selected}
            reloadTick={treeTick}
            cutPath={clipPath}
            onSelect={(name, segs) => {
              setSelected(name)
              if (segs.length) goto(segs.slice(0, -1))
            }}
            onCtxMenu={(x, y, name, segs, isDir) => setCtx({ kind: 'entry', x, y, segs, name, isDir })}
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
        <div className="empty-state" onContextMenu={(ev) => {
          ev.preventDefault()
          setCtx({ kind: 'blank', x: ev.clientX, y: ev.clientY })
        }}>
          <div className="emoji">⏳</div>
          <div>读取中…</div>
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="empty-state"
          onContextMenu={(ev) => {
            ev.preventDefault()
            setCtx({ kind: 'blank', x: ev.clientX, y: ev.clientY })
          }}
        >
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
        <div
          className="fm-grid"
          onContextMenu={(ev) => {
            ev.preventDefault()
            setCtx({ kind: 'blank', x: ev.clientX, y: ev.clientY })
          }}
        >
          {filtered.map((e) => (
            <div
              key={e.name}
              className={`fm-item ${selected === e.name ? 'sel' : ''} ${
                clipPath === [...segments, e.name].join('/') ? 'cutting' : ''
              }`}
              draggable
              onDragStart={(ev) => startDrag(ev, [...segments, e.name])}
              onClick={() => setSelected(e.name)}
              onDoubleClick={() => onOpen(e)}
              onContextMenu={(ev) => {
                ev.preventDefault()
                ev.stopPropagation()
                setSelected(e.name)
                setCtx({ kind: 'entry', x: ev.clientX, y: ev.clientY, segs: segments, name: e.name, isDir: e.isDir })
              }}
              title={`${e.name}\n拖到下方终端可插入路径`}
            >
              <TreeItemIcon isDir={e.isDir} open={false} name={e.name} size="lg" />
              <div className="fm-name">{e.name}</div>
            </div>
          ))}
        </div>
      ) : (
        <div
          className="fm-list"
          onContextMenu={(ev) => {
            ev.preventDefault()
            setCtx({ kind: 'blank', x: ev.clientX, y: ev.clientY })
          }}
        >
          <div className="fm-list-head">
            <span>名称</span>
            <span>类型</span>
            <span>大小</span>
          </div>
          {filtered.map((e) => (
            <div
              key={e.name}
              className={`fm-list-row ${selected === e.name ? 'sel' : ''} ${
                clipPath === [...segments, e.name].join('/') ? 'cutting' : ''
              }`}
              draggable
              onDragStart={(ev) => startDrag(ev, [...segments, e.name])}
              onClick={() => setSelected(e.name)}
              onDoubleClick={() => onOpen(e)}
              onContextMenu={(ev) => {
                ev.preventDefault()
                ev.stopPropagation()
                setSelected(e.name)
                setCtx({ kind: 'entry', x: ev.clientX, y: ev.clientY, segs: segments, name: e.name, isDir: e.isDir })
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
            {ctx.kind === 'entry' ? (
              <>
                <button
                  className="ctx-item"
                  onClick={() => {
                    const c = ctx
                    setCtx(null)
                    if (c.isDir) {
                      goto([...c.segs, c.name])
                      setSelected(null)
                    } else {
                      // 按 c.segs 打开（树视图右键时 c.segs 可能不是当前目录）
                      void openFile(handle, [...c.segs, c.name]).then((f) => {
                        if (f) {
                          setCenterTopTab('editor')
                          const ws = workspaces.find((w) => w.id === activeWorkspaceId)
                          if (ws) {
                            touchRecentFile({
                              name: c.name,
                              segments: [...c.segs, c.name],
                              workspaceId: ws.id,
                              workspacePath: ws.path,
                            })
                          }
                          showToast(`已打开 ${c.name}`, 'info')
                        } else {
                          showToast(`无法打开 ${c.name}`, 'error')
                        }
                      })
                    }
                  }}
                >
                  <span>{ctx.isDir ? '打开文件夹' : '打开'}</span>
                </button>
                <div className="ctx-sep" />
                <button
                  className="ctx-item"
                  onClick={() => {
                    const c = ctx
                    setCtx(null)
                    doClip(c.segs, c.name, c.isDir, true)
                  }}
                >
                  <span>剪切</span>
                  <span className="ctx-hint">Ctrl+X</span>
                </button>
                <button
                  className="ctx-item"
                  onClick={() => {
                    const c = ctx
                    setCtx(null)
                    doClip(c.segs, c.name, c.isDir, false)
                  }}
                >
                  <span>复制</span>
                  <span className="ctx-hint">Ctrl+C</span>
                </button>
                <div className="ctx-sep" />
                {ctx.isDir && (
                  <button
                    className="ctx-item"
                    disabled={!clip}
                    title={clip ? undefined : '剪贴板为空'}
                    onClick={() => {
                      const c = ctx
                      setCtx(null)
                      void pasteInto([...c.segs, c.name])
                    }}
                  >
                    <span>粘贴到文件夹内</span>
                  </button>
                )}
                <button
                  className="ctx-item"
                  onClick={() => {
                    const c = ctx
                    setCtx(null)
                    void doRename(c.segs, c.name)
                  }}
                >
                  <span>重命名</span>
                  <span className="ctx-hint">F2</span>
                </button>
                <button
                  className="ctx-item danger"
                  onClick={() => {
                    const c = ctx
                    setCtx(null)
                    void doDelete(c.segs, c.name)
                  }}
                >
                  <span>删除</span>
                  <span className="ctx-hint">Del</span>
                </button>
                <div className="ctx-sep" />
                {ctx.isDir && (
                  <button
                    className="ctx-item"
                    onClick={() => {
                      const c = ctx
                      setCtx(null)
                      promoteWorkspace([...c.segs, c.name])
                    }}
                  >
                    在此打开工作区
                  </button>
                )}
                <button
                  className="ctx-item"
                  onClick={() => {
                    const c = ctx
                    setCtx(null)
                    sendToAgent(absOf([...c.segs, c.name]))
                  }}
                >
                  把路径插入当前终端
                </button>
                <button
                  className="ctx-item"
                  onClick={() => {
                    const c = ctx
                    setCtx(null)
                    void copyPath(false, [...c.segs, c.name])
                  }}
                >
                  复制绝对路径
                </button>
                <button
                  className="ctx-item"
                  onClick={() => {
                    const c = ctx
                    setCtx(null)
                    void copyPath(true, [...c.segs, c.name])
                  }}
                >
                  复制相对路径
                </button>
                {handle.kind === 'electron' && (
                  <button
                    className="ctx-item"
                    onClick={() => {
                      const c = ctx
                      setCtx(null)
                      void window.ringcode?.revealInExplorer(absOf([...c.segs, c.name]))
                    }}
                  >
                    在资源管理器中显示
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  className="ctx-item"
                  onClick={() => {
                    setCtx(null)
                    void newFile()
                  }}
                >
                  <span>新建文件</span>
                </button>
                <button
                  className="ctx-item"
                  onClick={() => {
                    setCtx(null)
                    void newFolder()
                  }}
                >
                  <span>新建文件夹</span>
                </button>
                <div className="ctx-sep" />
                <button
                  className="ctx-item"
                  disabled={!clip}
                  title={clip ? undefined : '剪贴板为空'}
                  onClick={() => {
                    setCtx(null)
                    void pasteInto(segments)
                  }}
                >
                  <span>粘贴</span>
                  <span className="ctx-hint">Ctrl+V</span>
                </button>
                <div className="ctx-sep" />
                <button
                  className="ctx-item"
                  onClick={() => {
                    setCtx(null)
                    reload()
                  }}
                >
                  <span>刷新</span>
                </button>
              </>
            )}
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
  reloadTick,
  cutPath,
  onSelect,
  onOpenFile,
  onDragPath,
  onCtxMenu,
}: {
  handle: import('@/lib/fs').DirHandle
  segments: string[]
  name: string
  isDir: boolean
  depth: number
  ignoreMatcher: IgnoreMatcher | null
  selectedPath: string | null
  /** 父级操作（增删改/粘贴）后递增，各层级重新拉取子项 */
  reloadTick: number
  /** 剪切项路径（仅当前根），匹配的节点半透明标识 */
  cutPath: string | null
  onSelect: (name: string, segs: string[]) => void
  onOpenFile: (segs: string[]) => void
  onDragPath: (e: React.DragEvent, segs: string[]) => void
  onCtxMenu: (x: number, y: number, name: string, segs: string[], isDir: boolean) => void
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
  }, [handle, segments, open, isDir, ignoreMatcher, reloadTick])

  const pathKey = segments.join('/') || name
  const selected = selectedPath === name && (segments.length === 0 || segments[segments.length - 1] === name)
  const isCut = !!cutPath && cutPath === segments.join('/')

  return (
    <div>
      <div
        className={`fm-tree-row ${selected ? 'sel' : ''} ${isCut ? 'cutting' : ''}`}
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
        onContextMenu={
          segments.length > 0
            ? (ev) => {
                ev.preventDefault()
                ev.stopPropagation()
                onCtxMenu(ev.clientX, ev.clientY, name, segments, isDir)
              }
            : undefined
        }
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
              reloadTick={reloadTick}
              cutPath={cutPath}
              onSelect={onSelect}
              onOpenFile={onOpenFile}
              onDragPath={onDragPath}
              onCtxMenu={onCtxMenu}
            />
          ))}
        </div>
      )}
    </div>
  )
}
