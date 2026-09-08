import { describe, expect, it } from 'vitest'
import {
  normalizeOpenCodeExport,
  openCodeSessionUri,
  parseOpenCodeSessionList,
  sessionIdFromOpenCodeUri,
} from './opencodeHistory'

describe('OpenCode 历史适配器', () => {
  it('解析官方 session list JSON', () => {
    const records = parseOpenCodeSessionList(JSON.stringify([
      { id: 'ses_abcd1234', title: '修复登录', created: 1000, updated: 2000, directory: 'C:\\work' },
    ]))
    expect(records).toEqual([expect.objectContaining({
      tool: 'opencode',
      sessionId: 'ses_abcd1234',
      projectPath: 'C:\\work',
      title: '修复登录',
      startedAt: 1000,
      mtime: 2000,
    })])
  })

  it('把 export JSON 收敛成通用消息 JSONL', () => {
    const out = normalizeOpenCodeExport(JSON.stringify({
      info: { id: 'ses_abcd1234', title: '会话', directory: 'C:\\work', time: { created: 1000 } },
      messages: [
        { info: { role: 'user' }, parts: [{ type: 'text', text: '检查测试' }] },
        { info: { role: 'assistant' }, parts: [{ type: 'text', text: '测试通过' }, { type: 'tool' }] },
      ],
    }))
    expect(out?.searchText).toContain('检查测试')
    expect(out?.content).toContain('"role":"assistant"')
    expect(out?.content).toContain('测试通过')
  })

  it('只接受合法的合成 session URI', () => {
    expect(sessionIdFromOpenCodeUri(openCodeSessionUri('ses_abcd1234'))).toBe('ses_abcd1234')
    expect(sessionIdFromOpenCodeUri('opencode://session/..%2Fbad')).toBeNull()
  })
})
