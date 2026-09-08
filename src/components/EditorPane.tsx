import { useEffect, useRef } from 'react'
import Editor from '@monaco-editor/react'
import { useEditorStore } from '@/store/useEditorStore'
import { useAppStore } from '@/store/useAppStore'
import { ptyClient } from '@/lib/ptyClient'
import { getLanguageIdByFilename } from '@/lib/languages'
import { pasteToTerminal } from '@/lib/terminalRegistry'
import type { DirHandle } from '@/lib/fs'

export function EditorPane() {
  const files = useEditorStore((s) => s.files)
  const activeId = useEditorStore((s) => s.activeId)
  const setActive = useEditorStore((s) => s.setActive)
  const closeFile = useEditorStore((s) => s.closeFile)
  const updateContent = useEditorStore((s) => s.updateContent)
  const saveFile = useEditorStore((s) => s.saveFile)
  const reloadFromDisk = useEditorStore((s) => s.reloadFromDisk)
  const markConflict = useEditorStore((s) => s.markConflict)
  const resolveTheme = useAppStore((s) => s.resolveTheme)
  const showToast = useAppStore((s) => s.showToast)
  const setCenterTopTab = useAppStore((s) => s.setCenterTopTab)
  const layout = useAppStore((s) => s.layout)
  const setLayout = useAppStore((s) => s.setLayout)

  const active = files.find((f) => f.id === activeId) ?? null
  const monacoTheme = resolveTheme() === 'dark' ? 'vs-dark' : 'light'
  const editorRef = useRef<any>(null)
  const terminals = useAppStore((s) => s.terminals)
  const activeTerminalId = useAppStore((s) => s.activeTerminalId)

  /** 找到可写入的 AI 终端 tabId（优先当前激活的 AI 终端） */
  const aiTabId =
    terminals.find((t) => t.id === activeTerminalId && t.kind === 'ai')?.id ??
    terminals.find((t) => t.kind === 'ai')?.id ??
    null

  /** 构造文件绝对路径（仅 Electron 真实工作区） */
  const filePathOf = (h: DirHandle | undefined, segments: string[]): string | null => {
    if (h?.kind === 'electron') return [h.rootPath, ...segments].join('/')
    return null
  }

  const togglePanel = useAppStore((s) => s.togglePanel)
  const setActiveTerminal = useAppStore((s) => s.setActiveTerminal)

  const insertToSession = (text: string) => {
    if (!aiTabId) {
      showToast('没有可用的 AI 会话终端', 'error')
      return
    }
    if (layout.bottomHidden) {
      togglePanel('bottom')
    }
    if (activeTerminalId !== aiTabId) {
      setActiveTerminal(aiTabId)
    }
    const pasted = pasteToTerminal(aiTabId, text)
    if (!pasted) {
      if (!ptyClient.isReal) {
        showToast('需要桌面环境才能插入到会话', 'error')
        return
      }
      ptyClient.write(aiTabId, text)
    }
    showToast('已插入到 AI 会话', 'success')
  }

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (activeId) {
          const ok = await saveFile(activeId)
          showToast(ok ? '已保存' : '保存失败', ok ? 'success' : 'error')
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeId, saveFile, showToast])

  if (files.length === 0) {
    return (
      <div className="empty-state">
        <div className="emoji">📝</div>
        <div>没有打开的文件</div>
        <div style={{ fontSize: 11 }}>在文件管理器中双击文件以打开</div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="pane-tabs">
        {files.map((f) => (
          <div
            key={f.id}
            className={`tab ${f.id === activeId ? 'active' : ''}`}
            onClick={() => setActive(f.id)}
          >
            {f.dirty && <span style={{ color: 'var(--warning)' }}>● </span>}
            {f.name}
            <span
              className="close"
              onClick={(e) => {
                e.stopPropagation()
                closeFile(f.id)
              }}
            >
              ×
            </span>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        {active?.name.toLowerCase().endsWith('.md') && (
          <div
            className="tab"
            onClick={() => {
              if (layout.editorPreviewSplit) {
                setLayout({ editorPreviewSplit: false })
                setCenterTopTab('preview')
              } else {
                setLayout({ editorPreviewSplit: true })
              }
            }}
            title="并排预览"
          >
            {layout.editorPreviewSplit ? '关闭并排' : '并排预览'}
          </div>
        )}
        {active && (
          <>
            <button
              className="tab"
              title="插入所选文本到 AI 会话"
              onClick={() => {
                const ed = editorRef.current
                const sel = ed?.getSelection?.()
                if (sel && !sel.isEmpty()) {
                  const model = ed?.getModel?.()
                  const txt = model ? model.getValueInRange(sel) : ''
                  if (txt) {
                    insertToSession(txt)
                    return
                  }
                }
                showToast('未选中文本', 'info')
              }}
            >
              插入所选
            </button>
            <button
              className="tab"
              title="插入文件路径到 AI 会话"
              onClick={() => {
                const p = filePathOf(active.handle, active.segments)
                if (p) insertToSession(p + ' ')
                else showToast('仅支持真实工作区文件', 'info')
              }}
            >
              插入路径
            </button>
          </>
        )}
      </div>
      {active?.conflict && (
        <div className="conflict-banner">
          磁盘上的文件已被外部修改。未保存的编辑不会被覆盖。
          <button className="btn" onClick={() => void reloadFromDisk(active.id)}>
            放弃本地，加载磁盘
          </button>
          <button className="btn" onClick={() => markConflict(active.id, false)}>
            保留本地
          </button>
        </div>
      )}
      {active && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <Editor
            height="100%"
            theme={monacoTheme}
            path={active.name}
            language={getLanguageIdByFilename(active.name)}
            value={active.content}
            onChange={(v) => updateContent(active.id, v ?? '')}
            onMount={(ed) => {
              editorRef.current = ed
            }}
            options={{
              fontSize: 13,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              fontFamily: 'JetBrains Mono, Consolas, monospace',
              fontLigatures: true,
              smoothScrolling: true,
              renderLineHighlight: 'line',
            }}
          />
        </div>
      )}
    </div>
  )
}
