import { cleanTitleText, cleanTranscript, displayTitle } from './sessionText'
import type { HistoryMatch, Session } from '@/types'

export type HistoryRole = 'user' | 'assistant' | 'tool' | 'system'

export interface HistoryMessage {
  role: HistoryRole
  text: string
}

export function historyAliasKey(tool: string, nativeSessionId: string): string {
  return `${tool}:${nativeSessionId}`
}

/** 将升级前未绑定原生 ID 的本地记录与磁盘历史做保守的一对一匹配。 */
export function findHistoryLinks(
  sessions: Session[],
  matches: HistoryMatch[],
  maxStartDelta = 5 * 60_000,
): Array<{ sessionId: string; nativeSessionId: string; nativeTitle: string }> {
  const usedNativeIds = new Set(sessions.map((s) => s.nativeSessionId).filter((id): id is string => !!id))
  const available = matches.filter((m) => !usedNativeIds.has(m.sessionId))
  const links: Array<{ sessionId: string; nativeSessionId: string; nativeTitle: string }> = []
  const samePath = (a: string, b: string) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()

  for (const session of sessions.filter((s) => !s.nativeSessionId).sort((a, b) => a.createdAt - b.createdAt)) {
    const localTitle = cleanTitleText(session.title).toLowerCase()
    const candidates = available
      .filter(
        (m) =>
          !usedNativeIds.has(m.sessionId) &&
          m.tool === (session.family || session.tool) &&
          samePath(m.projectPath, session.cwd) &&
          Math.abs(m.startedAt - session.createdAt) <= maxStartDelta,
      )
      .map((m) => ({
        match: m,
        titlePenalty: localTitle && cleanTitleText(m.title).toLowerCase() === localTitle ? 0 : 1,
        timeDelta: Math.abs(m.startedAt - session.createdAt),
      }))
      .sort((a, b) => a.titlePenalty - b.titlePenalty || a.timeDelta - b.timeDelta)
    const best = candidates[0]?.match
    if (!best) continue
    usedNativeIds.add(best.sessionId)
    links.push({ sessionId: session.id, nativeSessionId: best.sessionId, nativeTitle: best.title })
  }
  return links
}

/** 已关联且仍为自动标题的本地记录，用磁盘上的 Agent 总结标题刷新。 */
export function syncNativeHistoryTitles(
  sessions: Session[],
  matches: HistoryMatch[],
): Array<{ sessionId: string; nativeSessionId: string; nativeTitle: string }> {
  const out = findHistoryLinks(sessions, matches)
  const seen = new Set(out.map((item) => item.sessionId))
  for (const session of sessions) {
    if (seen.has(session.id) || !session.nativeSessionId || session.autoTitled === false) continue
    const match = matches.find((item) => item.tool === (session.family || session.tool) && item.sessionId === session.nativeSessionId)
    if (!match?.title.trim()) continue
    out.push({ sessionId: session.id, nativeSessionId: match.sessionId, nativeTitle: match.title })
  }
  return out
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (typeof b.text === 'string') parts.push(b.text)
    else if (typeof b.content === 'string') parts.push(b.content)
    else if (Array.isArray(b.content)) parts.push(textFromContent(b.content))
  }
  return parts.join('\n')
}

function normalizeRole(role: unknown, type?: unknown): HistoryRole | null {
  const r = typeof role === 'string' ? role.toLowerCase() : ''
  const t = typeof type === 'string' ? type.toLowerCase() : ''
  if (r === 'user' || r === 'human') return 'user'
  if (r === 'assistant' || r === 'model') return 'assistant'
  if (r === 'tool' || r === 'tool_result') return 'tool'
  if (!r && t === 'user') return 'user'
  if (!r && t === 'gemini') return 'assistant'
  if (r === 'system' || t === 'system') return 'system'
  return null
}

/** 将内置 Agent 的 JSONL 尽量收敛为可阅读消息；未知事件会被安全忽略。 */
export function parseHistoryMessages(raw: string): HistoryMessage[] {
  const messages: HistoryMessage[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue
    let ev: Record<string, unknown>
    try {
      ev = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }

    if (ev.isSidechain === true || ev.type === 'attachment') continue
    const direct = ev.message
    if (direct && typeof direct === 'object') {
      const msg = direct as Record<string, unknown>
      let role = normalizeRole(msg.role, ev.type)
      if (
        Array.isArray(msg.content) &&
        msg.content.some((block) => block && typeof block === 'object' && (block as Record<string, unknown>).type === 'tool_result')
      ) role = 'tool'
      const text = cleanTranscript(textFromContent(msg.content)).slice(0, 20_000)
      if (role && text) messages.push({ role, text })
      continue
    }

    const payload = ev.payload
    if (payload && typeof payload === 'object') {
      const p = payload as Record<string, unknown>
      const role = normalizeRole(p.role, p.type ?? ev.type)
      const text = cleanTranscript(textFromContent(p.content ?? p.message ?? p.text))
      if (role && text) messages.push({ role, text })
      continue
    }

    const role = normalizeRole(ev.role, ev.type)
    const text = cleanTranscript(textFromContent(ev.content ?? ev.text))
    if (role && text) messages.push({ role, text })
  }
  return messages
}

export function messagesToText(messages: HistoryMessage[]): string {
  return messages.map((m) => `${m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : m.role === 'tool' ? '工具' : '系统'}：${m.text}`).join('\n\n')
}

export function historyFallbackText(raw: string): string {
  const parts: string[] = []
  const collect = (value: unknown) => {
    if (typeof value === 'string') {
      const text = cleanTranscript(value)
      if (text.length >= 4 && !parts.includes(text)) parts.push(text)
    } else if (Array.isArray(value)) {
      value.forEach(collect)
    } else if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>
      for (const key of ['summary', 'aiTitle', 'text', 'content', 'message', 'payload']) {
        if (key in obj) collect(obj[key])
      }
    }
  }
  for (const line of raw.split(/\r?\n/)) {
    try {
      collect(JSON.parse(line))
    } catch {
      /* 非 JSONL 行忽略 */
    }
  }
  return parts.join('\n\n')
}

/**
 * 为没有原生 fork 的 Agent 构造有界上下文。
 * 只取最近有效对话，避免把整份终端日志塞进命令行或首条输入。
 */
export function buildBranchContext(
  title: string,
  messages: HistoryMessage[],
  fallbackTranscript = '',
  maxChars = 12_000,
): string {
  const useful = messages.filter((m) => m.role === 'user' || m.role === 'assistant')
  const fallback = cleanTranscript(fallbackTranscript)
  const rows = useful.length
    ? useful.map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.text}`)
    : fallback
      ? [fallback]
      : []
  const picked: string[] = []
  let size = 0
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]
    if (picked.length >= 10 || (size + row.length > maxChars && picked.length > 0)) break
    const remaining = Math.max(0, maxChars - size)
    picked.unshift(row.slice(-remaining))
    size += Math.min(row.length, remaining)
  }
  const safeTitle = displayTitle(title, fallbackTranscript)
  return [
    `这是基于旧会话《${safeTitle}》创建的独立新会话。`,
    '请把下面内容作为背景上下文，不要声称正在恢复原会话。',
    '',
    ...picked,
  ].join('\n')
}
