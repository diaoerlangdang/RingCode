import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { useEditorStore } from '@/store/useEditorStore'
import { Splitter } from './Splitter'
import { FileManager } from './FileManager'
import { EditorPane } from './EditorPane'
import { PreviewPane } from './PreviewPane'
import { TerminalPane } from './TerminalPane'
import { GitView } from './GitView'
import { SkillView } from './SkillView'
import { SearchView } from './SearchView'
import { agentById } from '@/lib/agents'
import { supportsComposer } from '@/lib/terminalComposer'
import { ptyClient } from '@/lib/ptyClient'

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
  const composerVisible = useAppStore((s) => ptyClient.isReal && s.terminals.some((t) =>
    (t.id === s.activeTerminalId || (s.layout.terminalSplit && t.id === s.splitTerminalId)) && t.kind === 'ai' &&
    supportsComposer(t.tool ? agentById(t.tool, s.settings.customAgents ?? [])?.sourceFamily || t.tool : undefined),
  ))
  const centerTopTab = useAppStore((s) => s.centerTopTab)
  const setCenterTopTab = useAppStore((s) => s.setCenterTopTab)
  const [maximized, setMaximized] = useState<'editor' | 'preview' | 'split-preview' | null>(null)
  const hasMarkdown = useEditorStore((s) => /\.(md|markdown)$/i.test(s.files.find((file) => file.id === s.activeId)?.name ?? ''))
  const toggleMaximize = (pane: NonNullable<typeof maximized>) => setMaximized((current) => current === pane ? null : pane)
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
    setMaximized(null)
  }, [centerTopTab])

  useEffect(() => {
    if (!layout.editorPreviewSplit && maximized === 'split-preview') setMaximized(null)
  }, [layout.editorPreviewSplit, maximized])

  useEffect(() => {
    if (!hasMarkdown) setMaximized(null)
  }, [hasMarkdown])

  const renderTop = () => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
      {visitedTabs['fm'] && (
        <div style={{ display: centerTopTab === 'fm' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
          <FileManager />
        </div>
      )}
      {visitedTabs['editor'] && (
        <div style={{ display: centerTopTab === 'editor' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'row' }}>
          <div className={maximized === 'editor' ? 'document-maximized' : undefined} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <EditorPane maximized={maximized === 'editor'} onMaximize={() => toggleMaximize('editor')} />
          </div>
          {layout.editorPreviewSplit && (
            <>
              <div style={{ width: 1, background: 'var(--border)' }} />
              <div className={maximized === 'split-preview' ? 'document-maximized' : undefined} style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
                <PreviewPane compact maximized={maximized === 'split-preview'} onMaximize={() => toggleMaximize('split-preview')} />
              </div>
            </>
          )}
        </div>
      )}
      {visitedTabs['preview'] && (
        <div className={maximized === 'preview' ? 'document-maximized' : undefined} style={{ display: centerTopTab === 'preview' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
          <PreviewPane maximized={maximized === 'preview'} onMaximize={() => toggleMaximize('preview')} />
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
      <div className="center-terminal" style={{ flex: 1, minHeight: composerVisible ? 320 : 0 }}>
        <TerminalPane />
      </div>
    </div>
  )
}
