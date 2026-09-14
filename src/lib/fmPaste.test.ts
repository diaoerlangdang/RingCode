import { describe, expect, it } from 'vitest'
import { resolvePasteDestName, uniqueCopyName } from './fmPaste'

describe('uniqueCopyName', () => {
  it('keeps the original name when free', () => {
    expect(uniqueCopyName('a.ts', false, new Set(['b.ts']))).toBe('a.ts')
  })

  it('adds 副本 then numbered copies without splitting folder extensions', () => {
    expect(uniqueCopyName('a.ts', false, new Set(['a.ts']))).toBe('a - 副本.ts')
    expect(uniqueCopyName('a.ts', false, new Set(['a.ts', 'a - 副本.ts']))).toBe('a - 副本 (2).ts')
    expect(uniqueCopyName('pkg.config', true, new Set(['pkg.config']))).toBe('pkg.config - 副本')
  })
})

describe('resolvePasteDestName', () => {
  it('renames only when copying', () => {
    expect(resolvePasteDestName({ name: 'a.ts', isDir: false, existing: new Set(['a.ts']), cut: false })).toEqual({
      ok: true,
      destName: 'a - 副本.ts',
    })
  })

  it('refuses a cut onto an existing name', () => {
    expect(resolvePasteDestName({ name: 'a.ts', isDir: false, existing: new Set(['a.ts']), cut: true })).toEqual({
      ok: false,
      reason: '目标已存在「a.ts」，请先处理重名再移动',
    })
  })

  it('keeps the cut name when the destination is free', () => {
    expect(resolvePasteDestName({ name: 'a.ts', isDir: false, existing: new Set(), cut: true })).toEqual({
      ok: true,
      destName: 'a.ts',
    })
  })
})
