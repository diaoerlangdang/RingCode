import { describe, expect, it } from 'vitest'
import { APP_UPDATE_REMIND_LATER_MS, shouldShowAutomaticUpdate } from './appUpdateEvents'

describe('shouldShowAutomaticUpdate', () => {
  const update = { newer: true, latestVersion: '0.4.2' }

  it('新版本立即提示，稍后提醒后 24 小时内不重复打扰', () => {
    expect(shouldShowAutomaticUpdate(update, '0.4.1', 100, 200)).toBe(true)
    expect(shouldShowAutomaticUpdate(update, '0.4.2', 100, 100 + APP_UPDATE_REMIND_LATER_MS - 1)).toBe(false)
    expect(shouldShowAutomaticUpdate(update, '0.4.2', 100, 100 + APP_UPDATE_REMIND_LATER_MS)).toBe(true)
  })

  it('没有新版本时不弹窗', () => {
    expect(shouldShowAutomaticUpdate({ newer: false, latestVersion: '0.4.2' })).toBe(false)
  })
})
