import { describe, expect, it } from 'vitest'
import { handleTerminalKeyEvent } from './terminalKeyHandler'

function key(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    type: 'keydown',
    key: 'v',
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
  } as KeyboardEvent
}

describe('handleTerminalKeyEvent', () => {
  it('Windows Ctrl+V 交还 Chromium 触发 xterm 的 paste 事件', () => {
    expect(handleTerminalKeyEvent(key())).toBe(false)
  })

  it('普通按键及 Ctrl+Shift+V 仍使用 xterm 默认行为', () => {
    expect(handleTerminalKeyEvent(key({ ctrlKey: false, key: 'a' }))).toBe(true)
    expect(handleTerminalKeyEvent(key({ shiftKey: true }))).toBe(true)
  })
})
