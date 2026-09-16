import { describe, expect, it } from 'vitest'
import { handleTerminalKeyEvent, shouldBlockTerminalMouseMode } from './terminalKeyHandler'

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

  it('Ctrl+C 仍交给终端，不把复制行为绑到键盘', () => {
    expect(handleTerminalKeyEvent(key({ key: 'c' }))).toBe(true)
  })

  it('只拦截纯鼠标上报模式，保留同序列中的其他终端模式', () => {
    expect(shouldBlockTerminalMouseMode([1000])).toBe(true)
    expect(shouldBlockTerminalMouseMode([1002, 1006])).toBe(true)
    expect(shouldBlockTerminalMouseMode([1002, 25])).toBe(false)
    expect(shouldBlockTerminalMouseMode([25])).toBe(false)
  })
})
