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
