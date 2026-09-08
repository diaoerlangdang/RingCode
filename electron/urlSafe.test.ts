import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl } from './urlSafe'

describe('isAllowedExternalUrl', () => {
  it('允许 http 和 https', () => {
    expect(isAllowedExternalUrl('https://example.com/a')).toBe(true)
    expect(isAllowedExternalUrl('http://localhost:5174')).toBe(true)
  })

  it('拒绝 file javascript 和其他协议', () => {
    expect(isAllowedExternalUrl('file:///C:/Windows/notepad.exe')).toBe(false)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternalUrl('smb://evil/share')).toBe(false)
  })

  it('拒绝非法 URL', () => {
    expect(isAllowedExternalUrl('not a url')).toBe(false)
    expect(isAllowedExternalUrl('')).toBe(false)
  })
})
