const SKIP_BODY_TYPES = new Set([
  'attachment',
  'last-prompt',
  'mode',
  'permission-mode',
  'file-history-snapshot',
  'queue-operation',
  'ai-title',
  'summary',
  'progress',
])

export function shouldSkipHistoryBodyEvent(ev: Record<string, unknown>): boolean {
  if (ev.isSidechain === true) return true
  const type = typeof ev.type === 'string' ? ev.type.toLowerCase() : ''
  return SKIP_BODY_TYPES.has(type)
}

/** Claude ai-title / summary，以及事件或 payload 上的 title / thread_name。后出现的 ai-title 覆盖前者。 */
export function cliTitleFromEvent(ev: Record<string, unknown>): { title: string; replace: boolean } | null {
  const type = ev.type
  if (type === 'ai-title' && typeof ev.aiTitle === 'string' && ev.aiTitle.trim()) {
    return { title: ev.aiTitle, replace: true }
  }
  if (type === 'summary' && typeof ev.summary === 'string' && ev.summary.trim()) {
    return { title: ev.summary, replace: false }
  }
  if (typeof ev.title === 'string' && ev.title.trim()) {
    return { title: ev.title, replace: false }
  }
  const payload = ev.payload
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>
    if (typeof p.thread_name === 'string' && p.thread_name.trim()) {
      return { title: p.thread_name, replace: true }
    }
    if (typeof p.title === 'string' && p.title.trim()) {
      return { title: p.title, replace: false }
    }
  }
  return null
}

export function contentHasToolResult(content: unknown): boolean {
  return Array.isArray(content)
    && content.some((block) => block && typeof block === 'object' && (block as Record<string, unknown>).type === 'tool_result')
}

export function applyCliTitle(current: string, ev: Record<string, unknown>): string {
  const found = cliTitleFromEvent(ev)
  if (!found) return current
  if (found.replace || !current) return found.title
  return current
}
