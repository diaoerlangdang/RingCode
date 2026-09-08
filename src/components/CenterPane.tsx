import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { Splitter } from './Splitter'
import { FileManager } from './FileManager'
import { EditorPane } from './EditorPane'
import { PreviewPane } from './PreviewPane'
import { TerminalPane } from './TerminalPane'
import { GitView } from './GitView'
import { SkillView } from './SkillView'
import { SearchView } from './SearchView'

const TABS = [
  { key: 'fm', label: '文件管理器' },
  { key: 'editor', label: '编辑器' },
  { key: 'preview', label: '预览' },
  { key: 'diff', label: 'diff' },
  { key: 'skills', label: 'Skill' },
  { key: 'search', label: '搜索' },
] as const

export function CenterPane() {
  const layout = useAppStore((s) => s.layout)
  const setLayout = useAppStore((s) => s.setLayout)
  const centerTopTab = useAppStore((s) => s.centerTopTab)
  const setCenterTopTab = useAppStore((s) => s.setCenterTopTab)
  const ref = useRef<HTMLDivElement>(null)
  const fmRef = useRef<HTMLDivElement>(null)
  const splitRef = useRef(layout.centerSplit)
  splitRef.current = layout.centerSplit

  const onVResize = (delta: number) => {
    const h = ref.current?.clientHeight ?? 600
    const next = Math.min(0.85, Math.max(0.15, splitRef.current + delta / h))
    splitRef.current = next
    if (fmRef.current) fmRef.current.style.height = next * 100 + '%'
  }
  const onVResizeEnd = () => setLayout({ centerSplit: splitRef.current })

  const [visitedTabs, setVisitedTabs] = useState<Record<string, boolean>>({ [centerTopTab]: true })

  useEffect(() => {
    setVisitedTabs((prev) => (prev[centerTopTab] ? prev : { ...prev, [centerTopTab]: true }))
  }, [centerTopTab])

  const renderTop = () => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
      {visitedTabs['fm'] && (
        <div style={{ display: centerTopTab === 'fm' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
          <FileManager />
        </div>
      )}
      {visitedTabs['editor'] && (
        <div style={{ display: centerTopTab === 'editor' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'row' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <EditorPane />
          </div>
          {layout.editorPreviewSplit && (
            <>
              <div style={{ width: 1, background: 'var(--border)' }} />
              <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
                <PreviewPane />
              </div>
            </>
          )}
        </div>
      )}
      {visitedTabs['preview'] && (
        <div style={{ display: centerTopTab === 'preview' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
          <PreviewPane />
        </div>
      )}
      {visitedTabs['diff'] && (
        <div style={{ display: centerTopTab === 'diff' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
          <GitView />
        </div>
      )}
      {visitedTabs['skills'] && (
        <div style={{ display: centerTopTab === 'skills' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
          <SkillView />
        </div>
      )}
      {visitedTabs['search'] && (
        <div style={{ display: centerTopTab === 'search' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
          <SearchView />
        </div>
      )}
    </div>
  )

  const tabBar = (
    <div className="pane-tabs">
      {TABS.map((t) => (
        <div
          key={t.key}
          className={`tab ${centerTopTab === t.key ? 'active' : ''}`}
          onClick={() => setCenterTopTab(t.key)}
        >
          {t.label}
        </div>
      ))}
      <div style={{ flex: 1 }} />
    </div>
  )

  if (layout.bottomHidden) {
    return (
      <div className="center" ref={ref}>
        <div className="center-fm" style={{ flex: 1 }}>
          {tabBar}
          {renderTop()}
        </div>
      </div>
    )
  }

  return (
    <div className="center" ref={ref}>
      <div ref={fmRef} className="center-fm" style={{ height: `${layout.centerSplit * 100}%` }}>
        {tabBar}
        {renderTop()}
      </div>
      <Splitter direction="horizontal" onResize={onVResize} onResizeEnd={onVResizeEnd} onDoubleClick={() => setLayout({ centerSplit: 0.4 })} />
      <div className="center-terminal" style={{ flex: 1, minHeight: 0 }}>
        <TerminalPane />
      </div>
    </div>
  )
}
