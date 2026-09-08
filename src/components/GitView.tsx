// Git 面板（GIT-001/002/003/004）：通过主进程 git CLI 实现真实状态/diff/暂存/提交。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import type { GitFile, GitLogEntry, GitStatus } from '@/types'

/** 把状态码映射为可读标签与颜色 token */
function statusLabel(f: GitFile): { text: string; color: string } {
  const { index, worktree } = f
  if (index === '?' && worktree === '?') return { text: 'U', color: 'var(--text-caption)' }
  if (index === 'A' || worktree === '?') return { text: 'A', color: 'var(--success)' }
  if (index === 'D' || worktree === 'D') return { text: 'D', color: 'var(--error)' }
  if (index === 'R') return { text: 'R', color: 'var(--accent)' }
  if (index === 'M' || worktree === 'M') return { text: 'M', color: 'var(--warning)' }
  if (index === 'C') return { text: 'C', color: 'var(--accent)' }
  return { text: index === ' ' ? worktree : index, color: 'var(--text-caption)' }
}

function DiffViewer({ diff }: { diff: string }) {
  if (!diff) {
    return <div style={{ padding: 16, color: 'var(--text-caption)', fontSize: 12 }}>无差异内容（未跟踪文件不产生 diff）</div>
  }
  const lines = diff.split('\n')
  return (
    <pre className="git-diff" style={{ margin: 0, padding: 8, fontSize: 12, lineHeight: 1.6, overflow: 'auto', flex: 1 }}>
      {lines.map((ln, i) => {
        let color = 'var(--text)'
        let bg = 'transparent'
        if (ln.startsWith('+++') || ln.startsWith('---')) color = 'var(--text-caption)'
        else if (ln.startsWith('@@')) color = 'var(--accent)'
        else if (ln.startsWith('diff --git') || ln.startsWith('index ')) color = 'var(--text-caption)'
        else if (ln.startsWith('+')) {
          color = 'var(--success)'
          bg = 'var(--success-bg, rgba(80,200,120,0.08))'
        } else if (ln.startsWith('-')) {
          color = 'var(--error)'
          bg = 'var(--danger-bg, rgba(240,90,90,0.08))'
        }
        return (
          <div key={i} style={{ color, background: bg, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {ln || ' '}
          </div>
        )
      })}
    </pre>
  )
}

export function GitView() {
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const workspaces = useAppStore((s) => s.workspaces)
  const showToast = useAppStore((s) => s.showToast)
  const showConfirm = useAppStore((s) => s.showConfirm)
  const ws = workspaces.find((w) => w.id === activeWorkspaceId)
  const cwd = ws?.path
  const api = window.ringcode

  const [status, setStatus] = useState<GitStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<{ path: string; staged: boolean } | null>(null)
  const [diff, setDiff] = useState('')
  const [commitMsg, setCommitMsg] = useState('')
  const [log, setLog] = useState<GitLogEntry[]>([])
  const [branches, setBranches] = useState<{ name: string; current: boolean }[]>([])

  const refresh = useCallback(async () => {
    if (!cwd || !api) return
    setLoading(true)
    try {
      const [s, l, b] = await Promise.all([
        api.gitStatus(cwd),
        api.gitLog(cwd, 20).catch(() => [] as GitLogEntry[]),
        api.gitBranches(cwd).catch(() => []),
      ])
      setStatus(s)
      setLog(l)
      setBranches(b)
    } catch (e) {
      showToast('Git 状态读取失败：' + (e as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }, [cwd, api, showToast])

  useEffect(() => {
    refresh()
  }, [refresh])

  // 选中文件改变 -> 加载对应 diff
  useEffect(() => {
    if (!cwd || !api || !selected || !status?.isRepo) {
      setDiff('')
      return
    }
    const f = status.files.find((x) => x.path === selected.path)
    const untracked = f?.index === '?' && f?.worktree === '?'
    if (untracked) {
      setDiff('')
      return
    }
    let cancelled = false
    api.gitDiff(cwd, { staged: selected.staged, path: selected.path }).then((d) => {
      if (!cancelled) setDiff(d)
    })
    return () => {
      cancelled = true
    }
  }, [selected, cwd, api, status])

  const stagedFiles = useMemo(() => (status?.files ?? []).filter((f) => f.staged), [status])
  const unstagedFiles = useMemo(
    () => (status?.files ?? []).filter((f) => !f.staged),
    [status],
  )

  const doStage = async (paths: string[]) => {
    if (!cwd || !api || !paths.length) return
    try {
      await api.gitStage(cwd, paths)
      showToast(`已暂存 ${paths.length} 个文件`, 'success')
      await refresh()
    } catch (e) {
      showToast('暂存失败：' + (e as Error).message, 'error')
    }
  }
  const doUnstage = async (paths: string[]) => {
    if (!cwd || !api || !paths.length) return
    try {
      await api.gitUnstage(cwd, paths)
      showToast(`已取消暂存 ${paths.length} 个文件`, 'success')
      await refresh()
    } catch (e) {
      showToast('取消暂存失败：' + (e as Error).message, 'error')
    }
  }
  const doCommit = async () => {
    if (!cwd || !api) return
    if (!commitMsg.trim()) {
      showToast('请输入提交信息', 'error')
      return
    }
    if (!stagedFiles.length) {
      showToast('没有已暂存的更改', 'error')
      return
    }
    // GIT-003：执行前明确展示影响范围
    const list = stagedFiles.map((f) => f.path).join('\n  ')
    if (!(await showConfirm(`将提交以下 ${stagedFiles.length} 个已暂存文件：\n  ${list}\n\n确认提交？`))) return
    try {
      await api.gitCommit(cwd, commitMsg.trim())
      showToast('提交成功', 'success')
      setCommitMsg('')
      await refresh()
    } catch (e) {
      showToast('提交失败：' + (e as Error).message, 'error')
    }
  }
  const doCheckout = async (branch: string) => {
    if (!cwd || !api || !branch) return
    try {
      await api.gitCheckout(cwd, branch)
      showToast(`已切换到 ${branch}`, 'success')
      await refresh()
    } catch (e) {
      showToast('切换分支失败：' + (e as Error).message, 'error')
    }
  }

  if (!api) {
    return (
      <div className="empty-state">
        <div className="emoji">🔌</div>
        <div>Git 功能需要桌面环境</div>
      </div>
    )
  }
  if (!cwd) {
    return (
      <div className="empty-state">
        <div className="emoji">📂</div>
        <div>请先打开一个工作区</div>
      </div>
    )
  }
  if (status && !status.isRepo) {
    return (
      <div className="empty-state">
        <div className="emoji">🔀</div>
        <div>当前工作区不是 Git 仓库</div>
        <div style={{ fontSize: 11 }}>在终端执行 git init 以启用 Git 功能</div>
      </div>
    )
  }

  const renderFile = (f: GitFile, staged: boolean) => {
    const lbl = statusLabel(f)
    const isSel = selected?.path === f.path && selected?.staged === staged
    return (
      <div
        key={f.path + (f.oldPath ?? '')}
        className={`git-file ${isSel ? 'active' : ''}`}
        onClick={() => setSelected({ path: f.path, staged })}
        title={f.oldPath ? `${f.oldPath} -> ${f.path}` : f.path}
      >
        <span className="git-badge" style={{ color: lbl.color }}>
          {lbl.text}
        </span>
        <span className="git-path">{f.path}</span>
        {staged ? (
          <button className="git-act" title="取消暂存" onClick={(e) => { e.stopPropagation(); doUnstage([f.path]) }}>
            −
          </button>
        ) : (
          <button className="git-act" title="暂存" onClick={(e) => { e.stopPropagation(); doStage([f.path]) }}>
            +
          </button>
        )}
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* 头部：分支 + 远端差异 + 刷新 */}
      <div className="git-header">
        <span className="git-branch">⎇ {status?.branch ?? '…'}</span>
        {!!status?.ahead && <span className="git-badge" style={{ color: 'var(--success)' }} title="领先远端">↑{status.ahead}</span>}
        {!!status?.behind && <span className="git-badge" style={{ color: 'var(--warning)' }} title="落后远端">↓{status.behind}</span>}
        <select
          className="git-select"
          value={branches.find((b) => b.current)?.name ?? ''}
          onChange={(e) => doCheckout(e.target.value)}
          title="切换分支"
        >
          {branches.length === 0 && <option>—</option>}
          {branches.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
              {b.current ? ' (当前)' : ''}
            </option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <button className="git-btn" onClick={refresh} disabled={loading}>
          {loading ? '…' : '⟳ 刷新'}
        </button>
      </div>

      {/* 主体：左文件列表 + 右 diff */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div className="git-files">
          <div className="git-section">
            <div className="git-section-head">
              <span>已暂存 ({stagedFiles.length})</span>
              {stagedFiles.length > 0 && (
                <button className="git-link" onClick={() => doUnstage(stagedFiles.map((f) => f.path))}>全部取消</button>
              )}
            </div>
            {stagedFiles.length === 0 ? <div className="git-empty">无已暂存更改</div> : stagedFiles.map((f) => renderFile(f, true))}
          </div>
          <div className="git-section">
            <div className="git-section-head">
              <span>未暂存 ({unstagedFiles.length})</span>
              {unstagedFiles.length > 0 && (
                <button className="git-link" onClick={() => doStage(unstagedFiles.map((f) => f.path))}>全部暂存</button>
              )}
            </div>
            {unstagedFiles.length === 0 ? <div className="git-empty">无未暂存更改</div> : unstagedFiles.map((f) => renderFile(f, false))}
          </div>
          {log.length > 0 && (
            <div className="git-section">
              <div className="git-section-head"><span>最近提交</span></div>
              {log.slice(0, 8).map((e) => (
                <div key={e.hash} className="git-log" title={`${e.author} · ${e.date}`}>
                  <span className="git-hash">{e.hash.slice(0, 7)}</span>
                  <span className="git-msg">{e.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="git-diff-wrap">
          {selected ? (
            <>
              <div className="git-diff-head">
                {selected.staged ? '已暂存' : '未暂存'}：{selected.path}
              </div>
              <DiffViewer diff={diff} />
            </>
          ) : (
            <div className="empty-state" style={{ flex: 1 }}>
              <div className="emoji">📄</div>
              <div>选择一个文件查看差异</div>
            </div>
          )}
        </div>
      </div>

      {/* 提交栏 */}
      <div className="git-commit">
        <textarea
          className="git-commit-input"
          placeholder={`提交信息（将提交 ${stagedFiles.length} 个已暂存文件）`}
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          rows={2}
        />
        <button className="git-btn primary" onClick={doCommit} disabled={!stagedFiles.length}>
          提交
        </button>
      </div>
    </div>
  )
}
