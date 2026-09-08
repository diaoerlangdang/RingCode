import { describe, expect, it } from 'vitest'
import { matchShortcut, parseShortcut } from './keymap'

function ev(partial: Partial<KeyboardEvent> & { key: string; code?: string }): KeyboardEvent {
  return {
    key: partial.key,
    code: partial.code ?? '',
    ctrlKey: !!partial.ctrlKey,
    shiftKey: !!partial.shiftKey,
    altKey: !!partial.altKey,
    metaKey: !!partial.metaKey,
  } as KeyboardEvent
}

describe('keymap', () => {
  it('解析 Ctrl+Shift+1', () => {
    expect(parseShortcut('Ctrl+Shift+1')).toEqual({
      ctrl: true,
      shift: true,
      alt: false,
      meta: false,
      key: '1',
    })
  })

  it('Digit1 匹配 Ctrl+Shift+1', () => {
    expect(
      matchShortcut(ev({ key: '1', code: 'Digit1', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+1'),
    ).toBe(true)
    expect(matchShortcut(ev({ key: '1', code: 'Digit1', ctrlKey: true }), 'Ctrl+Shift+1')).toBe(false)
  })
})
