import { expect, it, vi } from 'vitest'

it('saves, applies, and deletes a layout preset without changing its snapshot', async () => {
  vi.stubGlobal('window', {})
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  })
  const { useAppStore } = await import('./useAppStore')
  const initial = { ...useAppStore.getState().layout }
  useAppStore.getState().saveLayout('test layout')
  const saved = useAppStore.getState().savedLayouts.at(-1)!

  useAppStore.getState().togglePanel('left')
  expect(useAppStore.getState().layout.leftHidden).not.toBe(initial.leftHidden)
  useAppStore.getState().applySavedLayout(saved.id)
  expect(useAppStore.getState().layout).toEqual(initial)

  useAppStore.getState().deleteSavedLayout(saved.id)
  expect(useAppStore.getState().savedLayouts.some((layout) => layout.id === saved.id)).toBe(false)
  vi.unstubAllGlobals()
})
