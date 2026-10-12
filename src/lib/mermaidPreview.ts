import DOMPurify from 'dompurify'

let queue: Promise<unknown> = Promise.resolve()
let sequence = 0

/** Mermaid has shared configuration; serialize theme initialization with rendering across both preview panes. */
export function renderMermaidPreview(source: string, theme: 'dark' | 'light', isCurrent: () => boolean): Promise<string | null> {
  const task = queue.catch(() => undefined).then(async () => {
    if (!isCurrent()) return null
    const { default: mermaid } = await import('mermaid')
    if (!isCurrent()) return null
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: theme === 'dark' ? 'dark' : 'default',
      fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif',
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      suppressErrorRendering: true,
      secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'htmlLabels', 'flowchart', 'theme', 'themeVariables', 'themeCSS', 'fontFamily'],
    })
    const { svg } = await mermaid.render(`ringcode-diagram-${++sequence}`, source)
    return DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ['foreignObject', 'script', 'image', 'a'],
    })
  })
  queue = task
  return task
}
