import { expect, it, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { syncTerminalViewport } from './terminalViewport'

function makeTerminal(baseY: number, maxScroll: number) {
  const viewport = { scrollHeight: 420 + maxScroll, clientHeight: 420 }
  const screen = { clientHeight: 408 }
  const resize = vi.fn()
  const reset = vi.fn(), syncScrollArea = vi.fn()
  const term = {
    cols: 80,
    rows: 24,
    buffer: { active: { baseY } },
    element: {
      querySelector: (selector: string) => selector === '.xterm-viewport' ? viewport : screen,
    },
    resize,
    _core: { viewport: { reset, syncScrollArea } },
  } as unknown as Terminal
  return { term, resize, reset, syncScrollArea }
}

it('repairs a scrollbar stuck at the bottom after hidden output without changing final PTY size', () => {
  const { term, resize, reset, syncScrollArea } = makeTerminal(478, 0)
  expect(syncTerminalViewport(term)).toBe(true)
  expect(reset).toHaveBeenCalledOnce()
  expect(syncScrollArea).toHaveBeenCalledWith(true)
  expect(resize).not.toHaveBeenCalled()
})

it('does not resize a terminal whose scroll range already matches its buffer', () => {
  const { term, resize } = makeTerminal(478, 478 * 17)
  expect(syncTerminalViewport(term)).toBe(false)
  expect(resize).not.toHaveBeenCalled()
})
