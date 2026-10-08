import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { groupHistoryItems } from '@/lib/historyGrouping'
import { createTranscriptBuffer } from '@/lib/transcriptBuffer'
import type { Session } from '@/types'

describe('session activity', () => {
  let app: typeof import('./useAppStore').useAppStore

  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    vi.stubGlobal('window', {})
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
    app = (await import('./useAppStore')).useAppStore
    await app.persist.rehydrate()
    app.setState({ sessions: [], terminals: [], activeSessionId: null, activeTerminalId: null })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function start(tool: string) {
    const session = app.getState().createSession(tool, '', 'E:/project', { title: `${tool} session` })
    const terminalId = app.getState().newTerminal('ai', { tool, sessionId: session.id })
    app.getState().markSessionConversationStarted(session.id)
    return { session, terminalId }
  }

  function historyOrder() {
    return groupHistoryItems(app.getState().sessions, {
      getId: (s: Session) => s.id,
      getDirectory: (s) => s.cwd,
      getUpdatedAt: (s) => s.lastActiveAt,
      getTool: (s) => s.tool,
      getSearchText: (s) => s.transcript,
    }).flatMap((group) => group.items.map((s) => s.id))
  }

  it('keeps history order stable while two terminals flush alternating output', () => {
    const codex = start('codex')
    vi.advanceTimersByTime(1000)
    const antigravity = start('antigravity')
    const initialOrder = historyOrder()
    const initialTimes = app.getState().sessions.map((s) => s.lastActiveAt)
    const output = createTranscriptBuffer((id, chunk) => app.getState().appendTranscript(id, chunk))
    for (const id of [codex.session.id, antigravity.session.id, codex.session.id]) {
      output.push(id, 'new output\r\n')
      vi.advanceTimersByTime(400)
      expect(historyOrder()).toEqual(initialOrder)
    }
    expect(app.getState().sessions.map((s) => s.lastActiveAt)).toEqual(initialTimes)
    expect(app.getState().sessions.find((s) => s.id === codex.session.id)?.transcript).toBe('new output\r\nnew output\r\n')
  })

  it('does not move a session when native history returns the same link and title again', () => {
    const { session } = start('codex')
    app.getState().linkNativeSession(session.id, 'native-id', 'Native title')
    const before = app.getState().sessions
    const writesBefore = vi.mocked(localStorage.setItem).mock.calls.length
    vi.advanceTimersByTime(1000)
    app.getState().linkNativeSession(session.id, 'native-id', 'Native title')
    expect(app.getState().sessions).toBe(before)
    expect(vi.mocked(localStorage.setItem).mock.calls.length).toBe(writesBefore)
  })

  it('still updates a changed native title and the activity time on a new launch', () => {
    const session = app.getState().createSession('codex', '', 'E:/project')
    app.getState().linkNativeSession(session.id, 'native-id', 'First native title')
    vi.advanceTimersByTime(1000)
    app.getState().linkNativeSession(session.id, 'native-id', 'Updated native title')
    expect(app.getState().sessions[0].title).toBe('Updated native title')
    app.getState().setSessionStatus(session.id, 'interrupted')
    vi.advanceTimersByTime(1000)
    app.getState().setSessionStatus(session.id, 'running')
    expect(app.getState().sessions[0]).toMatchObject({ status: 'running', lastActiveAt: Date.now() })
  })

  it('marks a running session interrupted when its last terminal closes, including pending output', () => {
    const { session, terminalId } = start('codex')
    const output = createTranscriptBuffer((id, chunk) => app.getState().appendTranscript(id, chunk))
    output.push(session.id, 'pending output')
    app.getState().closeTerminal(terminalId)
    output.flushAll()
    expect(app.getState().terminals).toHaveLength(0)
    expect(app.getState().sessions.find((s) => s.id === session.id)).toMatchObject({ status: 'interrupted', transcript: 'pending output' })
  })

  it('keeps a session running until its other live terminal also closes', () => {
    const { session, terminalId } = start('codex')
    const other = app.getState().newTerminal('ai', { tool: 'codex', sessionId: session.id })
    app.getState().closeTerminal(terminalId)
    expect(app.getState().sessions.find((s) => s.id === session.id)?.status).toBe('running')
    app.getState().closeTerminal(other)
    expect(app.getState().sessions.find((s) => s.id === session.id)?.status).toBe('interrupted')
  })

  it.each(['ended', 'failed'] as const)('preserves %s when closing an already exited terminal', (status) => {
    const { session, terminalId } = start('codex')
    app.getState().setSessionStatus(session.id, status)
    app.getState().closeTerminal(terminalId)
    expect(app.getState().sessions.find((s) => s.id === session.id)?.status).toBe(status)
  })

  it('still discards a new empty session and leaves other running sessions alone', () => {
    const running = start('antigravity')
    const empty = app.getState().createSession('codex', '', 'E:/project')
    const tab = app.getState().newTerminal('ai', { tool: 'codex', sessionId: empty.id })
    app.getState().closeTerminal(tab)
    expect(app.getState().sessions.map((s) => [s.id, s.status])).toEqual([[running.session.id, 'running']])
  })
})
