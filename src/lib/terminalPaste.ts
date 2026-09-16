type ContextMenuEvent = Pick<MouseEvent, 'preventDefault' | 'stopPropagation'>
type MouseButtonEvent = Pick<MouseEvent, 'button' | 'stopPropagation'>
type PasteTarget = { paste: (text: string) => void; focus: () => void }
type ContextMenuTarget = PasteTarget & { getSelection: () => string }

/** 阻止右键鼠标事件先被启用鼠标协议的终端应用处理。 */
export function suppressTerminalRightMouseEvent(event: MouseButtonEvent): boolean {
  if (event.button !== 2) return false
  event.stopPropagation()
  return true
}

/** 将终端右键统一为粘贴，并沿用 xterm 对 bracketed paste 的处理。 */
export async function pasteTerminalFromContextMenu(
  event: ContextMenuEvent,
  terminal: PasteTarget,
  readClipboardText: () => string | Promise<string>,
): Promise<boolean> {
  event.preventDefault()
  event.stopPropagation()
  const text = await readClipboardText()
  if (!text) return false
  terminal.paste(text)
  terminal.focus()
  return true
}

/** 有选区时提供复制菜单；无选区时保持原有的右键粘贴。 */
export async function handleTerminalContextMenu(
  event: ContextMenuEvent,
  terminal: ContextMenuTarget,
  readClipboardText: () => string | Promise<string>,
  showCopyMenu: (selection: string) => void,
): Promise<'copy' | 'paste' | 'none'> {
  const selection = terminal.getSelection()
  if (selection) {
    event.preventDefault()
    event.stopPropagation()
    showCopyMenu(selection)
    return 'copy'
  }
  return (await pasteTerminalFromContextMenu(event, terminal, readClipboardText)) ? 'paste' : 'none'
}
