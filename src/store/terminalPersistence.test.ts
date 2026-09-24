import { expect, it, vi } from 'vitest'

it('migrates old embedded transcripts and restores separately saved transcripts', async () => {
  vi.resetModules()
  vi.stubGlobal('window', {})
  const saved = new Map<string, string>([
    ['ringcode-store', JSON.stringify({ state: { sessions: [
      { id: 'old', transcript: 'legacy text' },
      { id: 'new' },
      { id: 'empty' },
    ] }, version: 8 })],
    ['ringcode-transcript:new', 'separate text'],
  ])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value) },
    removeItem: (key: string) => { saved.delete(key) },
  })
  try {
    const { sqliteStorage } = await import('@/lib/sqliteStorage')
    const raw = await sqliteStorage.getItem('ringcode-store')
    const sessions = JSON.parse(raw!).state.sessions
    expect(sessions.map((session: { transcript: string }) => session.transcript)).toEqual([
      'legacy text', 'separate text', '',
    ])
    expect(saved.get('ringcode-transcript:old')).toBe('legacy text')
  } finally {
    vi.unstubAllGlobals()
  }
})

it('uses the Electron store for separate transcripts', async () => {
  vi.resetModules()
  const saved = new Map<string, string>([
    ['ringcode-store', JSON.stringify({ state: { sessions: [{ id: 's1' }] }, version: 8 })],
    ['ringcode-transcript:s1', 'hello'],
  ])
  const storeGet = vi.fn(async (key: string) => saved.get(key) ?? null)
  const storeSet = vi.fn(async (key: string, value: string) => { saved.set(key, value) })
  const storeDel = vi.fn(async (key: string) => { saved.delete(key) })
  vi.stubGlobal('window', { ringcode: { isElectron: true, storeGet, storeSet, storeDel } })
  try {
    const { sqliteStorage, transcriptKey } = await import('@/lib/sqliteStorage')
    expect(JSON.parse((await sqliteStorage.getItem('ringcode-store'))!).state.sessions[0].transcript).toBe('hello')
    await sqliteStorage.setItem(transcriptKey('s1'), 'updated')
    expect(storeSet).toHaveBeenCalledWith('ringcode-transcript:s1', 'updated')
    await sqliteStorage.removeItem(transcriptKey('s1'))
    expect(storeDel).toHaveBeenCalledWith('ringcode-transcript:s1')
  } finally {
    vi.unstubAllGlobals()
  }
})

it('does not serialize every saved transcript for each terminal output update', async () => {
  vi.resetModules()
  vi.stubGlobal('window', {})
  const writes = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => writes.get(key) ?? null,
    setItem: (key: string, value: string) => { writes.set(key, value) },
    removeItem: (key: string) => { writes.delete(key) },
  })
  try {
    const { useAppStore } = await import('./useAppStore')
    const sessions = Array.from({ length: 5 }, (_, i) => ({
      id: `session-${i}`,
      title: 'test',
      tool: 'codex',
      family: 'codex',
      workspaceId: '',
      profileId: '',
      cwd: '',
      status: 'running' as const,
      createdAt: 0,
      lastActiveAt: 0,
      transcript: 'x'.repeat(200_000),
      resumable: false,
    }))
    useAppStore.setState({ sessions })
    writes.clear()

    useAppStore.getState().appendTranscript('session-0', 'hello')

    expect(writes.get('ringcode-store')?.length).toBeLessThan(100_000)
    expect(writes.get('ringcode-transcript:session-0')).toHaveLength(200_000)
  } finally {
    vi.unstubAllGlobals()
  }
})
