import type { Terminal } from '@xterm/xterm'

/** xterm does not update its DOM scroll range while its tab is display:none. */
export function syncTerminalViewportOnShow(term: Terminal): boolean {
  const viewport = term.element?.querySelector<HTMLElement>('.xterm-viewport')
  const screen = term.element?.querySelector<HTMLElement>('.xterm-screen')
  if (!viewport || !screen || !term.rows || !term.buffer.active.baseY) return false

  const rowHeight = screen.clientHeight / term.rows
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) return false
  const maxScroll = viewport.scrollHeight - viewport.clientHeight
  if (maxScroll + rowHeight >= term.buffer.active.baseY * rowHeight) return false

  // A same-size fit is a no-op. A synchronous one-row round trip refreshes the
  // scroll area without changing the final terminal/PTY dimensions.
  const { cols, rows } = term
  term.resize(cols, rows + 1)
  term.resize(cols, rows)
  return true
}
