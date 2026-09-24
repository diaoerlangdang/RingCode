import { expect, it, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { syncTerminalViewportOnShow } from './terminalViewport'

function makeTerminal(baseY: number, maxScroll: number) {
  const viewport = { scrollHeight: 420 + maxScroll, clientHeight: 420 }
  const screen = { clientHeight: 408 }
  const resize = vi.fn()
  const term = {
    cols: 80,
    rows: 24,
    buffer: { active: { baseY } },
    element: {
      querySelector: (selector: string) => selector === '.xterm-viewport' ? viewport : screen,
    },
    resize,
  } as unknown as Terminal
  return { term, resize }
}

it('repairs a scrollbar stuck at the bottom after hidden output without changing final PTY size', () => {
  const { term, resize } = makeTerminal(478, 0)
  expect(syncTerminalViewportOnShow(term)).toBe(true)
  expect(resize.mock.calls).toEqual([[80, 25], [80, 24]])
})

it('does not resize a terminal whose scroll range already matches its buffer', () => {
  const { term, resize } = makeTerminal(478, 478 * 17)
  expect(syncTerminalViewportOnShow(term)).toBe(false)
  expect(resize).not.toHaveBeenCalled()
})
