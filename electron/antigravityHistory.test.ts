import { describe, expect, it } from 'vitest'
import {
  antigravityConversationSummary,
  antigravityConversationUri,
  conversationIdFromAntigravityUri,
  parseAntigravityLastConversations,
} from './antigravityHistory'

describe('Antigravity public history cache', () => {
  it('将工作区最近会话映射转成历史记录', () => {
    const records = parseAntigravityLastConversations(JSON.stringify({
      'E:\\work\\RingCode': 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    }), 1234)

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      tool: 'antigravity',
      projectPath: 'E:\\work\\RingCode',
      sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      title: 'Antigravity · RingCode',
      mtime: 1234,
    })
  })

  it('拒绝坏 JSON、相对路径和危险会话 ID', () => {
    expect(parseAntigravityLastConversations('bad', 1)).toEqual([])
    expect(parseAntigravityLastConversations(JSON.stringify({ relative: '../bad' }), 1)).toEqual([])
  })

  it('合成 URI 可安全往返，并明确正文边界', () => {
    const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    expect(conversationIdFromAntigravityUri(antigravityConversationUri(id))).toBe(id)
    expect(conversationIdFromAntigravityUri('antigravity://conversation/..%2Fbad')).toBeNull()
    expect(antigravityConversationSummary('E:\\work', id)).toContain('未提供非交互式会话列表或正文导出')
  })
})
