import { useMemo, useState } from 'react'
import { useFsStore } from '@/store/useFsStore'
import { useEditorStore } from '@/store/useEditorStore'
import { useAppStore } from '@/store/useAppStore'
import type { SearchMatch } from '@/types'

/**
 * 工作区搜索（PRD FIL-004）：按文件名或内容全文搜索当前工作区。
 * 主进程递归遍历，渲染层只展示结果（§9.3）。点击结果在编辑器打开文件。
 */
export function SearchView() {
  const handle = useFsStore((s) => s.handle)
  const rootName = useFsStore((s) => s.rootName)
  const openFile = useEditorStore((s) => s.openFile)
  const setCenterTopTab = useAppStore((s) => s.setCenterTopTab)
  const showToast = useAppStore((s) => s.showToast)

  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'content' | 'filename'>('content')
  const [results, setResults] = useState<SearchMatch[]>([])
  const [searching, setSearching] = useState(false)
  const [done, setDone] = useState(false)

  const rootPath = handle.kind === 'electron' ? handle.rootPath : ''

  const grouped = useMemo(() => {
    const map = new Map<string, SearchMatch[]>()
    for (const m of results) {
      if (!map.has(m.path)) map.set(m.path, [])
      map.get(m.path)!.push(m)
    }
    return [...map.entries()]
  }, [results])

  const runSearch = async () => {
    if (!rootPath) {
      showToast('请先打开工作区', 'info')
      return
    }
    if (!query.trim()) return
    setSearching(true)
    setDone(false)
    try {
      const r = await window.ringcode!.searchWorkspace(rootPath, query.trim(), mode)
      setResults(r)
    } catch (e) {
      showToast('搜索失败：' + (e as Error).message, 'error')
      setResults([])
    } finally {
      setSearching(false)
      setDone(true)
    }
  }

  const openResult = async (m: SearchMatch) => {
    const segs = m.path.split('/')
    const f = await openFile(handle, segs)
    if (f) setCenterTopTab('editor')
  }

  if (!rootPath) {
    return (
      <div className="empty-state">
        <div className="emoji">🔎</div>
        <div>请先打开工作区</div>
        <div style={{ fontSize: 11 }}>搜索需要真实的本地工作区</div>
      </div>
    )
  }

  return (
    <div className="search-view">
      <div className="search-bar">
        <input
          className="search-input"
          placeholder={mode === 'content' ? '搜索文件内容…' : '搜索文件名…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          autoFocus
        />
        <div className="search-mode">
          <button className={mode === 'content' ? 'active' : ''} onClick={() => setMode('content')}>内容</button>
          <button className={mode === 'filename' ? 'active' : ''} onClick={() => setMode('filename')}>文件名</button>
        </div>
        <button className="search-btn primary" onClick={runSearch} disabled={searching || !query.trim()}>
          {searching ? '搜索中…' : '搜索'}
        </button>
      </div>
      <div className="search-meta">
        工作区：{rootName}
        {done && ` · ${results.length} 个结果${results.length >= 200 ? '（已达上限）' : ''}`}
      </div>
      <div className="search-results">
        {results.length === 0 ? (
          done ? (
            <div className="empty-state"><div className="emoji">🚫</div><div>无匹配结果</div></div>
          ) : (
            <div className="empty-state"><div className="emoji">🔎</div><div>输入关键词后回车搜索</div></div>
          )
        ) : (
          grouped.map(([file, ms]) => (
            <div key={file} className="search-file">
              <div className="search-file-name" title={file}>{file}</div>
              <div className="search-file-matches">
                {ms.map((m, i) => (
                  <div key={i} className="search-match" onClick={() => openResult(m)}>
                    {m.line > 0 && <span className="search-line">L{m.line}</span>}
                    <span className="search-text">{m.text}</span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
