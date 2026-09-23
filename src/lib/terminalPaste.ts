type ContextMenuEvent = Pick<MouseEvent, 'preventDefault' | 'stopPropagation'>
type MouseButtonEvent = Pick<MouseEvent, 'button' | 'stopPropagation'>
type PasteTarget = { paste: (text: string) => boolean | void; focus: () => void }
type ContextMenuTarget = PasteTarget & { getSelection: () => string }

type TerminalPasteInput = {
  paste: (text: string) => void
  input: (data: string) => void
  modes: { bracketedPasteMode: boolean }
}

/** Keep multiline AI input from being interpreted as separate Enter presses. */
export function pasteTerminalText(terminal: TerminalPasteInput, text: string, family?: string): boolean {
  if (!text) return false
  if (!/[\r\n]/.test(text) || !family) {
    terminal.paste(text)
    return true
  }
  if (family === 'codex') {
    // Codex on Windows can submit CR-separated lines even during bracketed paste.
    // LF keeps the blank lines without introducing Enter (CR) input events.
    terminal.input(`\x1b[200~${text.replace(/\r\n?|\n/g, '\n')}\x1b[201~`)
    return true
  }
  if (!terminal.modes.bracketedPasteMode) return false
  terminal.paste(text)
  return true
}

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
  if (terminal.paste(text) === false) return false
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
