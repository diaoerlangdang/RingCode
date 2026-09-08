import { describe, expect, it } from 'vitest'
import {
  buildBranchContext,
  findHistoryLinks,
  historyAliasKey,
  historyFallbackText,
  parseHistoryMessages,
  syncNativeHistoryTitles,
} from './sessionHistory'

describe('parseHistoryMessages', () => {
  it('parses Claude Code user and assistant messages', () => {
    const raw = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'HELP_FIX_LOGIN' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'CHECK_CODE_FIRST' }] } }),
    ].join('\n')

    expect(parseHistoryMessages(raw)).toEqual([
      { role: 'user', text: 'HELP_FIX_LOGIN' },
      { role: 'assistant', text: 'CHECK_CODE_FIRST' },
    ])
  })

  it('skips non-JSON lines and parses payload format', () => {
    const raw = ['not json', JSON.stringify({ type: 'event_msg', payload: { role: 'user', message: 'CONTINUE_TEST' } })].join('\n')
    expect(parseHistoryMessages(raw)).toEqual([{ role: 'user', text: 'CONTINUE_TEST' }])
  })

  it('parses Gemini CLI user and gemini events', () => {
    const raw = [
      JSON.stringify({ type: 'user', content: 'CHECK_PROJECT' }),
      JSON.stringify({ type: 'gemini', content: 'READ_STRUCTURE' }),
    ].join('\n')

    expect(parseHistoryMessages(raw)).toEqual([
      { role: 'user', text: 'CHECK_PROJECT' },
      { role: 'assistant', text: 'READ_STRUCTURE' },
    ])
  })

  it('falls back to readable fields for unknown formats', () => {
    const raw = JSON.stringify({ summary: 'SESSION_SUMMARY', payload: { text: '\x1b[32mBODY_TEXT\x1b[0m' } })
    expect(historyFallbackText(raw)).toContain('SESSION_SUMMARY')
    expect(historyFallbackText(raw)).toContain('BODY_TEXT')
    expect(historyFallbackText(raw)).not.toContain('\x1b')
  })
})

describe('findHistoryLinks', () => {
  const local = {
    id: 'local-1',
    title: 'FIX_LOGIN',
    tool: 'claude',
    workspaceId: 'ws',
    profileId: 'profile',
    cwd: 'C:\\work\\demo',
    status: 'ended' as const,
    createdAt: 100_000,
    lastActiveAt: 100_000,
    transcript: '',
    resumable: false,
  }
  const disk = {
    tool: 'claude',
    projectPath: 'c:\\WORK\\demo\\',
    sessionFile: 'session.jsonl',
    sessionId: 'native-1',
    title: 'FIX_LOGIN',
    snippet: '',
    startedAt: 101_000,
    mtime: 120_000,
  }

  it('links old local records by agent, cwd and start time', () => {
    expect(findHistoryLinks([local], [disk])).toEqual([
      { sessionId: 'local-1', nativeSessionId: 'native-1', nativeTitle: 'FIX_LOGIN' },
    ])
  })

  it('does not link different directories or far-apart times', () => {
    expect(findHistoryLinks([local], [{ ...disk, projectPath: 'C:\\other' }])).toEqual([])
    expect(findHistoryLinks([local], [{ ...disk, startedAt: 900_000 }])).toEqual([])
  })
})

describe('syncNativeHistoryTitles', () => {
  it('refreshes already-linked auto titles from disk native titles', () => {
    const linked = {
      id: 'local-2',
      title: 'Claude session',
      tool: 'claude',
      workspaceId: 'ws',
      profileId: 'profile',
      cwd: 'C:\\work\\demo',
      status: 'ended' as const,
      createdAt: 100_000,
      lastActiveAt: 100_000,
      transcript: '',
      resumable: true,
      nativeSessionId: 'native-1',
      autoTitled: true,
    }
    const disk = {
      tool: 'claude',
      projectPath: 'c:\\WORK\\demo\\',
      sessionFile: 'session.jsonl',
      sessionId: 'native-1',
      title: 'pack portable exe',
      snippet: '',
      startedAt: 101_000,
      mtime: 120_000,
    }
    expect(syncNativeHistoryTitles([linked], [disk])).toEqual([
      { sessionId: 'local-2', nativeSessionId: 'native-1', nativeTitle: 'pack portable exe' },
    ])
    expect(syncNativeHistoryTitles([{ ...linked, autoTitled: false }], [disk])).toEqual([])
  })
})

describe('buildBranchContext', () => {
  it('marks an independent session and keeps only recent turns', () => {
    const messages = Array.from({ length: 14 }, (_, i) => ({
      role: (i % 2 ? 'assistant' : 'user') as 'assistant' | 'user',
      text: `msg ${i}`,
    }))
    const context = buildBranchContext('> old session', messages)

    expect(context).toContain('old session')
    expect(context).toContain('msg 13')
    expect(context).not.toContain('msg 0\n')
  })

  it('limits degraded context length', () => {
    const context = buildBranchContext('long session', [], 'x'.repeat(30_000), 2_000)
    expect(context.length).toBeLessThan(2_200)
  })

  it('alias key includes agent and native session id', () => {
    expect(historyAliasKey('claude', 'abc')).toBe('claude:abc')
  })
})
