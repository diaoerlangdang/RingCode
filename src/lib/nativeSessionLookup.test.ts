import { afterEach, expect, it, vi } from 'vitest'
import { createNativeSessionLookup } from './nativeSessionLookup'

afterEach(() => vi.useRealTimers())

it('stops scanning after a successful native session link', async () => {
  vi.useFakeTimers()
  const lookup = vi.fn().mockResolvedValue(true)
  const linker = createNativeSessionLookup(lookup)
  linker.schedule(100)
  await vi.advanceTimersByTimeAsync(100)
  linker.schedule(100)
  await vi.advanceTimersByTimeAsync(100)
  expect(lookup).toHaveBeenCalledOnce()
})

it('retries when history has not appeared yet and cancels pending work on dispose', async () => {
  vi.useFakeTimers()
  const lookup = vi.fn().mockResolvedValue(false)
  const linker = createNativeSessionLookup(lookup)
  linker.schedule(100)
  await vi.advanceTimersByTimeAsync(100)
  linker.schedule(100)
  await vi.advanceTimersByTimeAsync(100)
  expect(lookup).toHaveBeenCalledTimes(2)
  linker.schedule(100)
  linker.dispose()
  await vi.advanceTimersByTimeAsync(100)
  expect(lookup).toHaveBeenCalledTimes(2)
})

it('does not start overlapping scans while a lookup is in flight', async () => {
  vi.useFakeTimers()
  let finish!: (linked: boolean) => void
  const lookup = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve }))
  const linker = createNativeSessionLookup(lookup)
  linker.schedule(100)
  await vi.advanceTimersByTimeAsync(100)
  linker.schedule(100)
  await vi.advanceTimersByTimeAsync(100)
  expect(lookup).toHaveBeenCalledOnce()
  finish(true)
  await Promise.resolve()
  linker.schedule(100)
  await vi.advanceTimersByTimeAsync(100)
  expect(lookup).toHaveBeenCalledOnce()
})
