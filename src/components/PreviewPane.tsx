import { useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useEditorStore } from '@/store/useEditorStore'
import { resolveMarkdownAssetSegments } from '@/lib/markdownAssets'

marked.setOptions({ gfm: true, breaks: false })

type PreviewKind = 'markdown' | 'json' | 'html' | 'csv' | 'text' | 'image' | 'pdf'

function kindOf(name: string): PreviewKind {
  const n = name.toLowerCase()
  if (n.endsWith('.md') || n.endsWith('.markdown')) return 'markdown'
  if (n.endsWith('.json')) return 'json'
  if (n.endsWith('.html') || n.endsWith('.htm')) return 'html'
  if (n.endsWith('.csv')) return 'csv'
  if (n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.gif') || n.endsWith('.webp') || n.endsWith('.svg') || n.endsWith('.bmp')) return 'image'
  if (n.endsWith('.pdf')) return 'pdf'
  return 'text'
}

/** 简易 CSV 行解析：支持引号包裹与转义双引号 */
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else inQuotes = false
      } else cur += ch
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === ',') { out.push(cur); cur = '' }
      else cur += ch
    }
  }
  out.push(cur)
  return out
}

function parseCsv(text: string): string[][] {
  return text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0).map(parseCsvLine)
}

const SANITIZE_OPTS = { FORBID_TAGS: ['script', 'style', 'iframe'], FORBID_ATTR: ['onerror', 'onload'] }

/**
 * 统一预览面板（PRD EDT-004/EDT-006）：按文件类型分发渲染。
 * - Markdown：marked + DOMPurify
 * - HTML：DOMPurify 清洗后渲染（§9.7 禁用脚本）
 * - JSON：格式化美化
 * - CSV：表格
 * - 纯文本/代码：<pre>
 * - 图片/PDF：通过主进程受控读取为 data URL
 */
export function PreviewPane() {
  const files = useEditorStore((s) => s.files)
  const activeId = useEditorStore((s) => s.activeId)
  const active = files.find((f) => f.id === activeId) ?? null

  const kind = active ? kindOf(active.name) : 'text'

  const [markdownHtml, setMarkdownHtml] = useState('')
  const html = useMemo(() => {
    if (!active || kind !== 'html') return ''
    return DOMPurify.sanitize(active.content, SANITIZE_OPTS)
  }, [active?.content, active?.id, kind])

  useEffect(() => {
    if (!active || kind !== 'markdown') {
      setMarkdownHtml('')
      return
    }

    const raw = marked.parse(active.content, { async: false }) as string
    const sanitized = DOMPurify.sanitize(raw, SANITIZE_OPTS)
    setMarkdownHtml(sanitized)
    if (active.handle.kind !== 'electron' || !window.ringcode?.fsReadDataUrl) return

    const rootPath = active.handle.rootPath
    let alive = true
    const resolveImages = async () => {
      const doc = new DOMParser().parseFromString(sanitized, 'text/html')
      const images = [...doc.querySelectorAll('img[src]')]
      await Promise.all(
        images.map(async (image) => {
          const src = image.getAttribute('src') ?? ''
          const segments = resolveMarkdownAssetSegments(active.segments, src)
          if (!segments) return
          try {
            const dataUrl = await window.ringcode!.fsReadDataUrl(rootPath, segments)
            if (dataUrl) image.setAttribute('src', dataUrl)
          } catch {
            /* 保留原地址和 alt 文本，单张图片失败不影响整篇预览 */
          }
        }),
      )
      if (alive) setMarkdownHtml(DOMPurify.sanitize(doc.body.innerHTML, SANITIZE_OPTS))
    }
    void resolveImages()
    return () => {
      alive = false
    }
  }, [active?.content, active?.id, active?.mtime, kind])

  const csvRows = useMemo(() => (active && kind === 'csv' ? parseCsv(active.content) : []), [active?.content, active?.id, kind])

  const jsonFormatted = useMemo(() => {
    if (!active || kind !== 'json') return null
    try {
      return JSON.stringify(JSON.parse(active.content), null, 2)
    } catch {
      return null
    }
  }, [active?.content, active?.id, kind])

  // 图片/PDF：从主进程取 data URL（二进制）
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [urlError, setUrlError] = useState(false)
  useEffect(() => {
    if (!active || (kind !== 'image' && kind !== 'pdf')) {
      setDataUrl(null)
      setUrlError(false)
      return
    }
    const h = active.handle
    if (h.kind !== 'electron') {
      setUrlError(true)
      return
    }
    let alive = true
    window.ringcode
      ?.fsReadDataUrl(h.rootPath, active.segments)
      .then((url) => {
        if (!alive) return
        if (url) {
          setDataUrl(url)
          setUrlError(false)
        } else setUrlError(true)
      })
      .catch(() => alive && setUrlError(true))
    return () => {
      alive = false
    }
  }, [active?.id, active?.mtime, kind])

  if (!active) {
    return (
      <div className="empty-state">
        <div className="emoji">📄</div>
        <div>没有可预览的文件</div>
      </div>
    )
  }

  if (kind === 'image') {
    if (urlError) {
      return <div className="empty-state"><div className="emoji">🖼️</div><div>无法加载图片</div><div style={{ fontSize: 11 }}>{active.name}</div></div>
    }
    if (!dataUrl) return <div className="empty-state"><div className="emoji">⏳</div><div>加载中…</div></div>
    return <div className="preview-pane preview-image-wrap"><img src={dataUrl} alt={active.name} /></div>
  }

  if (kind === 'pdf') {
    if (urlError) {
      return <div className="empty-state"><div className="emoji">📄</div><div>无法加载 PDF</div><div style={{ fontSize: 11 }}>{active.name}</div></div>
    }
    if (!dataUrl) return <div className="empty-state"><div className="emoji">⏳</div><div>加载中…</div></div>
    return <div className="preview-pane preview-pdf-wrap"><iframe src={dataUrl} title={active.name} /></div>
  }

  if (kind === 'json') {
    return (
      <div className="preview-pane">
        {jsonFormatted !== null ? (
          <pre className="preview-json">{jsonFormatted}</pre>
        ) : (
          <pre className="preview-text">{active.content}</pre>
        )}
      </div>
    )
  }

  if (kind === 'csv') {
    if (csvRows.length === 0) {
      return <div className="empty-state"><div className="emoji">📋</div><div>空 CSV</div></div>
    }
    const header = csvRows[0]
    const body = csvRows.slice(1)
    return (
      <div className="preview-pane preview-csv-wrap">
        <table className="preview-csv">
          <thead>
            <tr>{header.map((c, i) => <th key={i}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri}>{row.map((c, ci) => <td key={ci}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (kind === 'text') {
    return (
      <div className="preview-pane">
        <pre className="preview-text">{active.content}</pre>
      </div>
    )
  }

  return <div className="preview-pane" dangerouslySetInnerHTML={{ __html: kind === 'markdown' ? markdownHtml : html }} />
}
