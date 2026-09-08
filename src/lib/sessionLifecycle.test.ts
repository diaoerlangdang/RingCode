import { describe, expect, it } from 'vitest'
import { createConversationInputTracker, rehydratePersistedSlice, shouldDiscardEmptySession } from './sessionLifecycle'

describe('rehydratePersistedSlice', () => {
  it('把持久化终端标为孤儿，避免重启后自动 spawn', () => {
    const next = rehydratePersistedSlice({
      terminals: [{ id: 't1', title: 'claude ①', kind: 'ai', autoMode: true }],
      sessions: [{ id: 's1', status: 'ended' }],
    })
    expect(next.terminals[0].orphaned).toBe(true)
    expect(next.sessions[0].status).toBe('ended')
  })

  it('把 running 会话改成 interrupted', () => {
    const next = rehydratePersistedSlice({
      terminals: [],
      sessions: [
        { id: 's1', status: 'running' },
        { id: 's2', status: 'failed' },
      ],
    })
    expect(next.sessions.map((s) => s.status)).toEqual(['interrupted', 'failed'])
  })
})

describe('empty local session cleanup', () => {
  it('丢弃已明确标记为空、且仅新建后关闭的本地会话', () => {
    expect(shouldDiscardEmptySession(
      { conversationStarted: false, favorite: false, autoTitled: true },
      { kind: 'ai', action: 'new' },
    )).toBe(true)
  })

  it('保留已开始、用户主动整理、恢复/分支以及旧版本会话', () => {
    const terminal = { kind: 'ai', action: 'new' }
    expect(shouldDiscardEmptySession({ conversationStarted: true }, terminal)).toBe(false)
    expect(shouldDiscardEmptySession({ conversationStarted: false, favorite: true }, terminal)).toBe(false)
    expect(shouldDiscardEmptySession({ conversationStarted: false, autoTitled: false }, terminal)).toBe(false)
    expect(shouldDiscardEmptySession({ conversationStarted: false }, { kind: 'ai', action: 'resume' })).toBe(false)
    expect(shouldDiscardEmptySession({ conversationStarted: false }, { kind: 'ai', action: 'fork' })).toBe(false)
    expect(shouldDiscardEmptySession({}, terminal)).toBe(false)
  })

  it('只有提交过非空终端输入才视为开始对话', () => {
    const tracker = createConversationInputTracker()
    expect(tracker.push('\r')).toBe(false)
    expect(tracker.push('\u001b[A')).toBe(false)
    expect(tracker.push('帮我检查这个项目')).toBe(false)
    expect(tracker.push('\r')).toBe(true)
  })

  it('删除全部待提交文字后回车仍视为空会话', () => {
    const tracker = createConversationInputTracker()
    expect(tracker.push('ab')).toBe(false)
    expect(tracker.push('\u007f\u007f\r')).toBe(false)
  })
})
