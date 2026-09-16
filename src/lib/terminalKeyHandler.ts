type TerminalKeyEvent = Pick<KeyboardEvent, 'type' | 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>

/** 返回 true 时由 xterm 处理按键；false 时交回 Chromium 的原生快捷键。 */
export function handleTerminalKeyEvent(_event: TerminalKeyEvent): boolean {
  const event = _event
  if (
    event.type === 'keydown' &&
    event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    event.key.toLowerCase() === 'v'
  ) {
    return false
  }
  return true
}

const TERMINAL_MOUSE_MODES = new Set([9, 1000, 1001, 1002, 1003, 1005, 1006, 1015, 1016])

/** Prevent a TUI-only mouse mode sequence so xterm keeps normal text selection. */
export function shouldBlockTerminalMouseMode(params: (number | number[])[]): boolean {
  const flat = params.flat()
  return flat.length > 0 && flat.every((value) => TERMINAL_MOUSE_MODES.has(value))
}
