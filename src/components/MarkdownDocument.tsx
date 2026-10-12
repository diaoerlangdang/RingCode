import { useEffect, useMemo, useRef, useState } from 'react'
import type { OpenFile } from '@/store/useEditorStore'
import { useAppStore } from '@/store/useAppStore'
import { parseMarkdownPreview } from '@/lib/markdownPreview'
import { resolveMarkdownAssetSegments } from '@/lib/markdownAssets'
import { renderMermaidPreview } from '@/lib/mermaidPreview'

export function MarkdownDocument({ file, compact = false, maximized = false, onMaximize }: {
  file: OpenFile
  compact?: boolean
  maximized?: boolean
  onMaximize?: () => void
}) {
  const preview = useMemo(() => parseMarkdownPreview(file.content), [file.content, file.id])
  const bodyRef = useRef<HTMLDivElement>(null)
  const [outlineOpen, setOutlineOpen] = useState(!compact)
  const [currentHeading, setCurrentHeading] = useState('')
  const theme = useAppStore((s) => s.resolveTheme())

  useEffect(() => {
    bodyRef.current?.scrollTo(0, 0)
  }, [file.id])

  useEffect(() => {
    const body = bodyRef.current
    if (!body || file.handle.kind !== 'electron' || !window.ringcode?.fsReadDataUrl) return
    let alive = true
    const rootPath = file.handle.rootPath
    for (const image of body.querySelectorAll<HTMLImageElement>('img[src]')) {
      const segments = resolveMarkdownAssetSegments(file.segments, image.getAttribute('src') ?? '')
      if (!segments) continue
      void window.ringcode.fsReadDataUrl(rootPath, segments).then((dataUrl) => {
        if (alive && dataUrl) image.src = dataUrl
      }).catch(() => { /* Keep the original source and alt text when one image fails. */ })
    }
    return () => { alive = false }
  }, [preview, file.id, file.mtime])

  useEffect(() => {
    const body = bodyRef.current
    if (!body || !preview.diagrams.length) return
    let alive = true
    const timer = setTimeout(() => {
      preview.diagrams.forEach((source, index) => {
        const figure = body.querySelector<HTMLElement>(`[data-diagram="${index}"]`)
        if (!figure) return
        const rendered = figure.querySelector<HTMLElement>('.diagram-render')!
        const status = figure.querySelector<HTMLElement>('.diagram-status')!
        const code = figure.querySelector<HTMLElement>('pre')!
        void renderMermaidPreview(source, theme, () => alive).then((svg) => {
          if (!alive || svg === null) return
          rendered.innerHTML = svg
          status.hidden = true
          code.hidden = true
        }).catch((error: unknown) => {
          if (!alive) return
          rendered.replaceChildren()
          status.hidden = false
          status.classList.add('error')
          status.textContent = `图表无法绘制：${error instanceof Error ? error.message : String(error)}`
          code.hidden = false
        })
      })
    }, 180)
    return () => { alive = false; clearTimeout(timer) }
  }, [preview, theme])

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    let frame = 0
    const update = () => {
      frame = 0
      const headings = [...body.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')]
      let current = headings[0]?.id ?? ''
      const top = body.getBoundingClientRect().top + 32
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top > top) break
        current = heading.id
      }
      setCurrentHeading(current)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    const observer = new ResizeObserver(schedule)
    for (const child of body.children) observer.observe(child)
    observer.observe(body)
    body.addEventListener('scroll', schedule, { passive: true })
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      body.removeEventListener('scroll', schedule)
    }
  }, [preview])

  const jumpToHeading = (id: string) => {
    const body = bodyRef.current
    const heading = body && [...body.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')].find((node) => node.id === id)
    if (!body || !heading) return
    body.scrollTop += heading.getBoundingClientRect().top - body.getBoundingClientRect().top - 16
    setCurrentHeading(id)
  }

  return (
    <div className="markdown-document">
      <div className="document-toolbar">
        <button className="btn" aria-expanded={outlineOpen} onClick={() => setOutlineOpen(!outlineOpen)}>目录</button>
        <span className="document-filename" title={file.name}>{file.name}</span>
        {onMaximize && <button className="btn" onClick={onMaximize}>{maximized ? '还原预览' : '最大化预览'}</button>}
      </div>
      <div className="markdown-layout">
        {outlineOpen && (
          <nav className="markdown-outline" aria-label="文档目录">
            {preview.headings.length ? preview.headings.map((heading) => (
              <button
                key={heading.id}
                className={`outline-heading${currentHeading === heading.id ? ' active' : ''}`}
                style={{ paddingLeft: 12 + (heading.level - 1) * 12 }}
                aria-current={currentHeading === heading.id ? 'location' : undefined}
                onClick={() => jumpToHeading(heading.id)}
                title={heading.text}
              >{heading.text}</button>
            )) : <p className="outline-empty">本文没有标题</p>}
          </nav>
        )}
        <div
          ref={bodyRef}
          className="preview-pane markdown-body"
          onClick={(event) => {
            const anchor = (event.target as HTMLElement).closest('a[href^="#"]')
            if (!anchor) return
            event.preventDefault()
            try { jumpToHeading(decodeURIComponent(anchor.getAttribute('href')!.slice(1))) } catch { /* Invalid anchor. */ }
          }}
          dangerouslySetInnerHTML={{ __html: preview.html }}
        />
      </div>
    </div>
  )
}
