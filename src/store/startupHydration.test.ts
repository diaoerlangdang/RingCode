import { afterEach, expect, it, vi } from 'vitest'

const { render } = vi.hoisted(() => ({ render: vi.fn() }))
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render }) }))
vi.mock('../App', () => ({ default: () => null }))
vi.mock('../lib/monacoSetup', () => ({}))
vi.mock('./useEditorStore', () => ({ useEditorStore: {} }))
vi.mock('./useFsStore', () => ({ useFsStore: {} }))

afterEach(() => { vi.unstubAllGlobals(); render.mockReset() })

it('loads persisted history before mounting startup effects that save the store', async () => {
  vi.resetModules()
  const original = JSON.stringify({ state: {
    workspaces: [{ id: 'workspace', name: 'existing', path: 'E:/existing' }],
    sessions: [{ id: 'session', title: 'existing', tool: 'codex', cwd: 'E:/existing', status: 'ended', createdAt: 1, lastActiveAt: 1 }],
  }, version: 8 })
  const saved = new Map([['ringcode-store', original], ['ringcode-transcript:session', 'existing conversation']])
  let finishRead!: () => void
  const pendingRead = new Promise<void>(resolve => { finishRead = resolve })
  const storeSet = vi.fn(async (key: string, value: string) => { saved.set(key, value) })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} })
  vi.stubGlobal('document', { getElementById: () => ({}) })
  vi.stubGlobal('window', { ringcode: {
    isElectron: true,
    storeGet: async (key: string) => {
      const value = saved.get(key) ?? null
      if (key === 'ringcode-store') await pendingRead
      return value
    }, storeSet, storeDel: async () => {},
  } })
  const { useAppStore } = await import('./useAppStore')
  render.mockImplementation(() => useAppStore.getState().setWizardOpen(true))
  const hydrated = new Promise<void>(resolve => useAppStore.persist.onFinishHydration(() => resolve()))
  await import('../main')
  const mountedBeforeRead = render.mock.calls.length
  const writesBeforeRead = storeSet.mock.calls.length
  finishRead()
  await hydrated
  await Promise.resolve()
  expect(mountedBeforeRead).toBe(0)
  expect(writesBeforeRead).toBe(0)
  expect(render).toHaveBeenCalledOnce()
  expect(JSON.parse(saved.get('ringcode-store')!).state.sessions).toHaveLength(1)
  expect(JSON.parse(saved.get('ringcode-store')!).state.workspaces).toHaveLength(1)

  // 模拟下一次启动，确认首轮持久化后的快照仍能完整加载。
  vi.resetModules()
  const restarted = (await import('./useAppStore')).useAppStore
  render.mockImplementation(() => restarted.getState().setWizardOpen(true))
  await import('../main')
  if (!restarted.persist.hasHydrated()) {
    await new Promise<void>(resolve => restarted.persist.onFinishHydration(() => resolve()))
  }
  expect(restarted.getState().sessions).toHaveLength(1)
  expect(restarted.getState().sessions[0].transcript).toBe('existing conversation')
  expect(JSON.parse(saved.get('ringcode-store')!).state.sessions).toHaveLength(1)
})
