import { describe, expect, it } from 'vitest'
import { isDriveRoot, joinWinPath } from './pathWin'

describe('pathWin', () => {
  it('识别盘符根', () => {
    expect(isDriveRoot('D:\\')).toBe(true)
    expect(isDriveRoot('D:')).toBe(true)
    expect(isDriveRoot('D:\\proj')).toBe(false)
  })

  it('拼接工作区相对段', () => {
    expect(joinWinPath('D:\\', [])).toBe('D:\\')
    expect(joinWinPath('D:\\', ['learn-work', 'RingCode'])).toBe('D:\\learn-work\\RingCode')
  })
})
