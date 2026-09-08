import * as path from 'node:path'
import type { DiskHistoryRecord } from './historyIndex'

const URI_PREFIX = 'antigravity://conversation/'
const SAFE_CONVERSATION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{3,255}$/

export function antigravityConversationUri(conversationId: string): string {
  return `${URI_PREFIX}${encodeURIComponent(conversationId)}`
}

export function conversationIdFromAntigravityUri(value: string): string | null {
  if (!value.startsWith(URI_PREFIX)) return null
  try {
    const id = decodeURIComponent(value.slice(URI_PREFIX.length))
    return SAFE_CONVERSATION_ID.test(id) ? id : null
  } catch {
    return null
  }
}

/** 解析官方文档公开的 workspace -> 最近 conversation id 缓存，不读取内部 conversations DB。 */
export function parseAntigravityLastConversations(raw: string, mtime: number): DiskHistoryRecord[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []

  return Object.entries(parsed as Record<string, unknown>).flatMap(([workspace, value]): DiskHistoryRecord[] => {
    if (!path.isAbsolute(workspace) || typeof value !== 'string' || !SAFE_CONVERSATION_ID.test(value)) return []
    const name = path.basename(path.normalize(workspace)) || workspace
    const title = `Antigravity · ${name}`
    return [{
      tool: 'antigravity',
      projectPath: workspace,
      sessionFile: antigravityConversationUri(value),
      sessionId: value,
      title,
      snippet: '最近会话（公开缓存不包含标题和正文）',
      searchText: `${title}\n${workspace}\n${value}`,
      startedAt: mtime,
      mtime,
    }]
  })
}

export function antigravityConversationSummary(projectPath: string, conversationId: string): string {
  return [
    'Antigravity CLI 最近会话',
    `工作区：${projectPath || '未知'}`,
    `会话 ID：${conversationId}`,
    '',
    'Antigravity 当前公开接口未提供非交互式会话列表或正文导出。',
    'RingCode 只读取官方公开的最近会话映射；可使用“继续会话”恢复完整上下文。',
  ].join('\n')
}
