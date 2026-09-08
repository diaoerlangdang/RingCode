import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTranscriptBuffer } from './transcriptBuffer'

describe('createTranscriptBuffer', () => {
  afterEach(() => vi.useRealTimers())

  it('在窗口内合并多次 push，到期后一次性 flush', () => {
    vi.useFakeTimers()
    const flush = vi.fn()
    const buf = createTranscriptBuffer(flush, 400)
    buf.push('s1', 'a')
    buf.push('s1', 'b')
    expect(flush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(400)
    expect(flush).toHaveBeenCalledOnce()
    expect(flush).toHaveBeenCalledWith('s1', 'ab')
  })

  it('flushAll 立即写出剩余缓冲', () => {
    vi.useFakeTimers()
    const flush = vi.fn()
    const buf = createTranscriptBuffer(flush, 400)
    buf.push('s1', 'hello')
    buf.flushAll()
    expect(flush).toHaveBeenCalledWith('s1', 'hello')
  })
})
