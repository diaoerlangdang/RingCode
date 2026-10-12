import { Marked } from 'marked'
import DOMPurify from 'dompurify'

export interface MarkdownHeading {
  id: string
  text: string
  level: number
}

const markdown = new Marked({ gfm: true, breaks: false })

/** Build the outline from the sanitized document, so inline formatting and fenced code agree with the preview. */
export function parseMarkdownPreview(content: string) {
  const raw = markdown.parse(content, { async: false }) as string
  const html = DOMPurify.sanitize(raw, {
    FORBID_TAGS: ['script', 'style', 'iframe'],
    FORBID_ATTR: ['onerror', 'onload'],
  })
  const doc = new DOMParser().parseFromString(html, 'text/html')
  // Reserve diagram indices for the placeholders generated below, not raw document HTML.
  for (const element of doc.querySelectorAll('[data-diagram]')) element.removeAttribute('data-diagram')
  const ids = new Set<string>()
  const headings: MarkdownHeading[] = [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((heading) => {
    const text = heading.textContent?.trim() || '无标题'
    const slug = text.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'section'
    let id = slug
    for (let suffix = 2; ids.has(id); suffix++) id = `${slug}-${suffix}`
    ids.add(id)
    heading.id = id
    return { id, text, level: Number(heading.tagName.slice(1)) }
  })
  const diagrams: string[] = []
  for (const code of doc.querySelectorAll('pre > code.language-mermaid')) {
    const figure = doc.createElement('figure')
    figure.className = 'markdown-diagram'
    figure.dataset.diagram = String(diagrams.length)
    figure.setAttribute('aria-label', 'Mermaid 图表')
    diagrams.push(code.textContent ?? '')
    const rendered = doc.createElement('div')
    rendered.className = 'diagram-render'
    const status = doc.createElement('p')
    status.className = 'diagram-status'
    status.setAttribute('role', 'status')
    status.textContent = '正在绘制图表…'
    const pre = code.parentElement!
    pre.replaceWith(figure)
    figure.append(rendered, status, pre)
  }
  return { html: doc.body.innerHTML, headings, diagrams }
}
