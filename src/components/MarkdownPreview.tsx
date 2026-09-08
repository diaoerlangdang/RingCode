import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useEditorStore } from '@/store/useEditorStore'

marked.setOptions({ gfm: true, breaks: false })

/** Markdown 实时预览。HTML 经 DOMPurify 清洗，禁用脚本（安全要求 §9.7）。 */
export function MarkdownPreview() {
  const files = useEditorStore((s) => s.files)
  const activeId = useEditorStore((s) => s.activeId)
  const active = files.find((f) => f.id === activeId) ?? null

  const html = useMemo(() => {
    if (!active) return ''
    const raw = marked.parse(active.content, { async: false }) as string
    return DOMPurify.sanitize(raw, { FORBID_TAGS: ['script', 'style', 'iframe'], FORBID_ATTR: ['onerror', 'onload'] })
  }, [active?.content, active?.id])

  if (!active) {
    return (
      <div className="empty-state">
        <div className="emoji">📄</div>
        <div>没有可预览的文件</div>
      </div>
    )
  }

  return <div className="preview-pane" dangerouslySetInnerHTML={{ __html: html }} />
}
