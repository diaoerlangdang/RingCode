import { describe, expect, it } from 'vitest'
import { sanitizeGitLogLimit } from './gitLimit'

describe('sanitizeGitLogLimit', () => {
  it('接受 1..500 的整数', () => {
    expect(sanitizeGitLogLimit(20)).toBe(20)
    expect(sanitizeGitLogLimit(500)).toBe(500)
    expect(sanitizeGitLogLimit(1)).toBe(1)
  })

  it('非法值回退到 50', () => {
    expect(sanitizeGitLogLimit(undefined)).toBe(50)
    expect(sanitizeGitLogLimit('all')).toBe(50)
    expect(sanitizeGitLogLimit(0)).toBe(50)
    expect(sanitizeGitLogLimit(9999)).toBe(50)
    expect(sanitizeGitLogLimit(3.14)).toBe(50)
  })
})
