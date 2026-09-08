import { useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useAppStore } from '@/store/useAppStore'
import type { Skill } from '@/types'

marked.setOptions({ gfm: true, breaks: false })

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/**
 * Skill 库视图（PRD §6.9 SKL-001/002/003，§7.4 导入流程）。
 * 导入本地文件夹 -> 主进程拷贝+指纹 -> 列表查看/搜索/删除。
 * SKILL.md 预览经 DOMPurify 清洗（§9.7）；删除二次确认（§9.8）。
 */
export function SkillView() {
  const skills = useAppStore((s) => s.skills)
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const workspaces = useAppStore((s) => s.workspaces)
  const addSkill = useAppStore((s) => s.addSkill)
  const deleteSkill = useAppStore((s) => s.deleteSkill)
  const showToast = useAppStore((s) => s.showToast)
  const showConfirm = useAppStore((s) => s.showConfirm)

  const [query, setQuery] = useState('')
  const [scopeFilter, setScopeFilter] = useState<'all' | 'global' | 'workspace'>('all')
  const [importScope, setImportScope] = useState<'global' | 'workspace'>('global')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preview, setPreview] = useState<string>('')
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [importing, setImporting] = useState(false)

  const wsName = (id?: string) => workspaces.find((w) => w.id === id)?.name ?? '未知工作区'

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return skills.filter((k) => {
      if (scopeFilter === 'global' && k.scope !== 'global') return false
      if (scopeFilter === 'workspace' && k.scope !== 'workspace') return false
      if (!q) return true
      return (
        k.name.toLowerCase().includes(q) ||
        k.description.toLowerCase().includes(q) ||
        k.fingerprint.toLowerCase().includes(q)
      )
    })
  }, [skills, query, scopeFilter])

  const selected = filtered.find((k) => k.id === selectedId) ?? null

  // 选中变化时加载 SKILL.md 正文
  useEffect(() => {
    if (!selected) {
      setPreview('')
      return
    }
    let alive = true
    setLoadingPreview(true)
    window.ringcode
      ?.skillReadContent(selected.id)
      .then((text) => {
        if (!alive) return
        if (text) {
          const raw = marked.parse(text, { async: false }) as string
          setPreview(
            DOMPurify.sanitize(raw, {
              FORBID_TAGS: ['script', 'style', 'iframe'],
              FORBID_ATTR: ['onerror', 'onload'],
            }),
          )
        } else {
          setPreview('')
        }
      })
      .catch(() => alive && setPreview(''))
      .finally(() => alive && setLoadingPreview(false))
    return () => {
      alive = false
    }
  }, [selected?.id])

  const handleImport = async () => {
    const api = window.ringcode
    if (!api?.isElectron) {
      showToast('当前环境不支持导入', 'error')
      return
    }
    const src = await api.openDirectoryDialog()
    if (!src) return
    setImporting(true)
    try {
      const meta = await api.skillImport(src, importScope, importScope === 'workspace' ? activeWorkspaceId ?? undefined : undefined)
      addSkill(meta)
      showToast(`已导入 Skill：${meta.name}`, 'success')
    } catch (e) {
      showToast('导入失败：' + (e as Error).message, 'error')
    } finally {
      setImporting(false)
    }
  }

  const handleDelete = async (skill: Skill, e: React.MouseEvent) => {
    e.stopPropagation()
    const scopeLabel = skill.scope === 'workspace' ? `（工作区：${wsName(skill.workspaceId)}）` : '（全局）'
    const ok = await showConfirm(
      `删除 Skill "${skill.name}"${scopeLabel}？\n\n将移除金刚琢 Skill 库中的本地副本，不影响原始来源文件夹。此操作不可撤销。`,
    )
    if (!ok) return
    window.ringcode
      ?.skillDelete(skill.id)
      .then(() => {
        deleteSkill(skill.id)
        if (selectedId === skill.id) setSelectedId(null)
        showToast(`已删除 Skill：${skill.name}`, 'info')
      })
      .catch((e) => showToast('删除失败：' + (e as Error).message, 'error'))
  }

  return (
    <div className="skill-view">
      <div className="skill-toolbar">
        <input
          className="skill-search"
          placeholder="搜索 Skill（名称/描述/指纹）"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="skill-select" value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value as 'all' | 'global' | 'workspace')}>
          <option value="all">全部作用域</option>
          <option value="global">全局</option>
          <option value="workspace">工作区</option>
        </select>
        <div className="skill-toolbar-right">
          <select
            className="skill-select"
            value={importScope}
            onChange={(e) => setImportScope(e.target.value as 'global' | 'workspace')}
            disabled={!activeWorkspaceId}
            title={activeWorkspaceId ? '导入作用域' : '未打开工作区，仅可导入到全局'}
          >
            <option value="global">导入到全局</option>
            <option value="workspace" disabled={!activeWorkspaceId}>导入到当前工作区</option>
          </select>
          <button className="skill-btn primary" onClick={handleImport} disabled={importing}>
            {importing ? '导入中…' : '导入 Skill 文件夹'}
          </button>
        </div>
      </div>

      <div className="skill-body">
        <div className="skill-list">
          {filtered.length === 0 ? (
            <div className="empty-state">
              <div className="emoji">🧩</div>
              <div>{skills.length === 0 ? '还没有导入 Skill' : '没有匹配的 Skill'}</div>
              <div style={{ fontSize: 11 }}>点击右上角“导入 Skill 文件夹”从本地导入</div>
            </div>
          ) : (
            filtered.map((k) => (
              <div
                key={k.id}
                className={`skill-card ${selectedId === k.id ? 'active' : ''}`}
                onClick={() => setSelectedId(k.id)}
              >
                <div className="skill-card-head">
                  <span className="skill-name" title={k.name}>{k.name}</span>
                  <span className={`skill-badge ${k.scope}`}>{k.scope === 'workspace' ? wsName(k.workspaceId) : '全局'}</span>
                </div>
                {k.description && <div className="skill-desc">{k.description}</div>}
                <div className="skill-meta">
                  <span title={k.sourcePath}>来源：{k.source === 'git' ? 'Git' : '本地'}</span>
                  <span>{k.fileCount} 文件</span>
                  <span>{fmtSize(k.totalSize)}</span>
                  <span className="skill-fp" title={k.fingerprint}>{k.fingerprint.slice(0, 12)}</span>
                  <span>{fmtDate(k.updatedAt)}</span>
                </div>
                <div className="skill-card-actions">
                  <button className="skill-btn danger" onClick={(e) => handleDelete(k, e)}>删除</button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="skill-preview">
          {loadingPreview ? (
            <div className="empty-state"><div className="emoji">⏳</div><div>加载中…</div></div>
          ) : selected ? (
            preview ? (
              <div className="preview-pane" dangerouslySetInnerHTML={{ __html: preview }} />
            ) : (
              <div className="empty-state">
                <div className="emoji">📄</div>
                <div>该 Skill 没有 SKILL.md</div>
                <div style={{ fontSize: 11 }}>{selected.name} · {selected.fileCount} 文件</div>
              </div>
            )
          ) : (
            <div className="empty-state">
              <div className="emoji">👈</div>
              <div>选择左侧 Skill 查看 SKILL.md</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
