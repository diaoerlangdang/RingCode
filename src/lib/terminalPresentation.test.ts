import { expect, it } from 'vitest'
import { nativeInputRegions, visibleTerminalSelection } from './terminalPresentation'

function screen(lines: string[], cursorY: number, cursorX = 2, baseY = 0) {
  const t = { rows: lines.length - baseY, cols: 60, modes: { bracketedPasteMode: true }, buffer: { active: { baseY, viewportY: baseY, cursorY, cursorX, length: lines.length,
    getLine: (i: number) => ({ isWrapped: false, translateToString: (trim = false, start = 0, end = 60) => {
      const value = (lines[i] ?? '').padEnd(60).slice(start, end)
      return trim ? value.trimEnd() : value
    } }) } }, getSelection: () => lines.join('\n'), getSelectionPosition: () => ({ start: { x: 0, y: 0 }, end: { x: 60, y: lines.length - 1 } }) }
  return t as any
}

it.each(['claude', 'codex', 'antigravity'])('hides only the %s input box and keeps its footer and raw buffer', (family) => {
  const marker = family === 'codex' ? '›' : family === 'claude' ? '❯' : '>'
  const lines = ['回答内容', '────────', marker, '────────', '模型状态']
  const t = screen(lines, 2), original = lines.join('\n')
  const regions = nativeInputRegions(t, family)
  expect(regions).toEqual([{ startRow: 1, endRow: 3, startColumn: 0, endColumn: 60 }])
  expect(visibleTerminalSelection(t, regions)).toBe('回答内容\n模型状态')
  expect(t.getSelection()).toBe(original)
})
it('keeps OpenCode metadata and adjacent sidebar cells visible', () => {
  const lines = ['结果', '  ┃                                   SIDEBAR', '  ┃  Ask anything... "QA"', '  ┃', '  ┃  Build · QA', '  ╹' + '─'.repeat(28), '  tab agents  ctrl+p commands']
  const t = screen(lines, 2, 5), regions = nativeInputRegions(t, 'opencode')
  expect(regions).toHaveLength(4)
  expect(regions[0]).toMatchObject({ startRow: 1, endRow: 3, startColumn: 2, endColumn: 31 })
  const selection = visibleTerminalSelection(t, regions)
  expect(selection).toContain('SIDEBAR')
  expect(selection).toContain('Build · QA')
})
it('does not cover trust dialogs, unknown native text or incomplete frames', () => {
  const menu = screen(['────────', '> Yes, I trust this folder', '  No, exit', '────────', '↑/↓ Navigate · enter Confirm'], 1)
  expect(nativeInputRegions(menu, 'antigravity')).toEqual([])
  expect(nativeInputRegions(screen(['Commands                 esc', 'Search'], 1), 'opencode')).toEqual([])
  expect(nativeInputRegions(screen(['────────', '> 未提交草稿', '────────'], 1), 'claude')).toEqual([])
  expect(nativeInputRegions(screen(['────────', '>'], 1), 'antigravity')).toEqual([])
})
it('identifies only the live prompt while preserving historical prompts', () => {
  const t = screen(['────────', '> 旧问题', '────────', '回答', '────────', '>', '────────', '状态'], 2, 2, 3)
  expect(nativeInputRegions(t, 'antigravity')).toEqual([{ startRow: 4, endRow: 6, startColumn: 0, endColumn: 60 }])
  expect(visibleTerminalSelection(t, nativeInputRegions(t, 'antigravity'))).toContain('> 旧问题')
})
it('hides staged multiline input only after its content matches the composer payload', () => {
  const t = screen(['────────', '> 第一行', '', '  第二行', '────────', '状态'], 3, 8)
  expect(nativeInputRegions(t, 'antigravity')).toEqual([])
  expect(nativeInputRegions(t, 'antigravity', { text: '第一行\n\n第二行', paths: [] })).toEqual([{ startRow: 0, endRow: 4, startColumn: 0, endColumn: 60 }])
  expect(nativeInputRegions(t, 'antigravity', { text: '另一份草稿', paths: [] })).toEqual([])
})
it('does not hide a prompt-shaped code example above the output cursor', () => {
  const t = screen(['────────', '>', '────────', '这只是代码示例', '后续输出'], 4)
  expect(nativeInputRegions(t, 'antigravity')).toEqual([])
})
