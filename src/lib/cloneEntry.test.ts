import { describe, expect, it } from 'vitest'
import { agentById } from './agents'
import { createCloneAgent } from './agentClone'
import { continueEntryHint, pickLinkedSession, resolveCloneEntry } from './cloneEntry'
import type { Session, TerminalTab } from '@/types'

const clone = createCloneAgent(agentById('codex')!, {
  id: 'clone-b',
  name: '便宜版 Codex',
  commandName: 'cheap-codex',
})

describe('分身入口解析', () => {
  it('本机默认上次入口，删除后回退原版，未关联磁盘用原版', () => {
    const extra = [clone]
    expect(resolveCloneEntry({ tool: 'clone-b', family: 'codex', lastCloneId: 'clone-b', extra }).agentId).toBe('clone-b')
    expect(resolveCloneEntry({ tool: 'clone-b', family: 'codex', lastCloneId: 'gone', extra }).fallback).toBe('deleted')
    expect(resolveCloneEntry({ tool: 'clone-b', family: 'codex', lastCloneId: 'gone', extra }).agentId).toBe('codex')
    expect(resolveCloneEntry({ tool: 'codex', family: 'codex', diskUnlinked: true, extra }).agentId).toBe('codex')
    expect(
      resolveCloneEntry({
        tool: 'codex',
        family: 'codex',
        diskUnlinked: true,
        preferredEntryId: 'clone-b',
        extra,
      }).agentId,
    ).toBe('clone-b')
    expect(continueEntryHint(resolveCloneEntry({ tool: 'clone-b', family: 'codex', lastCloneId: 'clone-b', extra }), extra)).toBe(
      '继续使用：便宜版 Codex',
    )
    expect(continueEntryHint(resolveCloneEntry({ tool: 'clone-b', family: 'codex', lastCloneId: 'gone', extra }), extra)).toBe(
      '原分身已删除，使用原版',
    )
  })

  it('hidden last entry still continues with that clone, not the original', () => {
    const extra = [clone]
    const resolved = resolveCloneEntry({ tool: 'codex', family: 'codex', lastCloneId: 'clone-b', extra })
    expect(resolved.agentId).toBe('clone-b')
    expect(resolved.fallback).toBeUndefined()
  })

  it('关联代表优先运行中终端，否则最近打开', () => {
    const sessions: Session[] = [
      {
        id: 'old',
        title: 'old',
        tool: 'clone-b',
        family: 'codex',
        nativeSessionId: 'n1',
        workspaceId: 'w',
        profileId: 'p',
        cwd: 'C:\\w',
        status: 'ended',
        createdAt: 1,
        lastActiveAt: 10,
        transcript: '',
        resumable: true,
      },
      {
        id: 'new',
        title: 'new',
        tool: 'codex',
        family: 'codex',
        nativeSessionId: 'n1',
        workspaceId: 'w',
        profileId: 'p',
        cwd: 'C:\\w',
        status: 'ended',
        createdAt: 2,
        lastActiveAt: 20,
        transcript: '',
        resumable: true,
      },
    ]
    expect(pickLinkedSession(sessions, [], { tool: 'codex', sessionId: 'n1' })?.id).toBe('new')
    const terminals: TerminalTab[] = [
      { id: 't', title: 't', kind: 'ai', sessionId: 'old', tool: 'clone-b', createdAt: 1 },
    ]
    expect(pickLinkedSession(sessions, terminals, { tool: 'codex', sessionId: 'n1' })?.id).toBe('old')
  })
})
