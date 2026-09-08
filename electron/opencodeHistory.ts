import type { DiskHistoryRecord } from './historyIndex'

const URI_PREFIX = 'opencode://session/'

interface OpenCodeSessionSummary {
  id: string
  title?: string
  updated?: number
  created?: number
  directory?: string
}

function safeTime(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function textParts(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((part) => {
    if (!part || typeof part !== 'object') return []
    const item = part as Record<string, unknown>
    return item.type === 'text' && typeof item.text === 'string' && item.text.trim() ? [item.text.trim()] : []
  })
}

export function openCodeSessionUri(sessionId: string): string {
  return `${URI_PREFIX}${encodeURIComponent(sessionId)}`
}

export function sessionIdFromOpenCodeUri(value: string): string | null {
  if (!value.startsWith(URI_PREFIX)) return null
  try {
    const id = decodeURIComponent(value.slice(URI_PREFIX.length))
    return /^[a-zA-Z0-9_-]{4,160}$/.test(id) ? id : null
  } catch {
    return null
  }
}

export function parseOpenCodeSessionList(raw: string): DiskHistoryRecord[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const now = Date.now()
  return parsed.flatMap((value): DiskHistoryRecord[] => {
    if (!value || typeof value !== 'object') return []
    const item = value as OpenCodeSessionSummary
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{4,160}$/.test(item.id)) return []
    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : item.id
    const created = safeTime(item.created, safeTime(item.updated, now))
    const updated = safeTime(item.updated, created)
    return [{
      tool: 'opencode',
      projectPath: typeof item.directory === 'string' ? item.directory : '',
      sessionFile: openCodeSessionUri(item.id),
      sessionId: item.id,
      title: title.slice(0, 120),
      snippet: title.slice(0, 200),
      searchText: title,
      startedAt: created,
      mtime: updated,
    }]
  })
}

/** 将 OpenCode 官方 export JSON 转成现有历史阅读器可消费的通用 JSONL。 */
export function normalizeOpenCodeExport(raw: string): { content: string; searchText: string } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const data = parsed as Record<string, unknown>
  const info = data.info && typeof data.info === 'object' ? data.info as Record<string, unknown> : {}
  const lines: string[] = [JSON.stringify({
    sessionId: info.id,
    cwd: info.directory,
    summary: info.title,
    timestamp: info.time && typeof info.time === 'object'
      ? new Date(Number((info.time as Record<string, unknown>).created) || Date.now()).toISOString()
      : undefined,
  })]
  const searchable: string[] = []
  if (typeof info.title === 'string') searchable.push(info.title)

  if (Array.isArray(data.messages)) {
    for (const value of data.messages) {
      if (!value || typeof value !== 'object') continue
      const message = value as Record<string, unknown>
      const messageInfo = message.info && typeof message.info === 'object'
        ? message.info as Record<string, unknown>
        : {}
      const role = messageInfo.role === 'user' ? 'user' : messageInfo.role === 'assistant' ? 'assistant' : null
      if (!role) continue
      const text = textParts(message.parts).join('\n').trim()
      if (!text) continue
      searchable.push(text)
      lines.push(JSON.stringify({ message: { role, content: text } }))
    }
  }

  return { content: `${lines.join('\n')}\n`, searchText: searchable.join('\n') }
}
