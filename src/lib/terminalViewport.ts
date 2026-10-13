import type { Terminal } from '@xterm/xterm'

/** Repair a stale DOM scroll range without resizing the buffer or its VT scroll margins. */
export function syncTerminalViewport(term: Terminal): boolean {
  const viewport = term.element?.querySelector<HTMLElement>('.xterm-viewport')
  const screen = term.element?.querySelector<HTMLElement>('.xterm-screen')
  if (!viewport || !screen || !term.rows || !term.buffer.active.baseY) return false

  const rowHeight = screen.clientHeight / term.rows
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) return false
  const maxScroll = viewport.scrollHeight - viewport.clientHeight
  if (maxScroll + rowHeight >= term.buffer.active.baseY * rowHeight) return false

  // xterm 5.5 has no public viewport refresh API. Keep this version-specific
  // access here; the Electron integration test verifies it against real xterm.
  const core = (term as Terminal & { _core?: { viewport?: { reset(): void; syncScrollArea(immediate: boolean): void } } })._core
  if (!core?.viewport) return false
  core.viewport.reset()
  core.viewport.syncScrollArea(true)
  return true
}
