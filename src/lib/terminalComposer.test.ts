import { expect, it } from 'vitest'
import { bracketedComposerText, composerPaste, composerPayload, promptCanReceive, promptHasDraft, supportsComposer, terminalHasMenu } from './terminalComposer'
import { createConversationInputTracker } from './sessionLifecycle'

function terminal(line: string, cursorX = 2, footer = '', bracketed = true) {
  const lines = [line, footer]
  return { modes: { bracketedPasteMode: bracketed }, buffer: { active: { baseY: 0, cursorY: 0, cursorX, length: lines.length, getLine: (i: number) => ({ translateToString: () => lines[i] ?? '', getCell: () => ({ getChars: () => 'x', isDim: () => false }) }) } } } as any
}
it('recognizes confirmation menus without treating busy output or scrolled history as a menu', () => {
  const lines = ['> No, exit', '  Yes, I trust this folder', 'Enter to confirm · Esc to cancel', '❯ ']
  const t = { rows: 3, buffer: { active: { baseY: 0, length: lines.length, getLine: (i: number) => ({ translateToString: () => lines[i] ?? '' }) } } } as any
  expect(terminalHasMenu(t)).toBe(true)
  t.rows = 4
  expect(terminalHasMenu(t)).toBe(false)
  t.buffer.active.baseY = 3
  expect(terminalHasMenu(t)).toBe(false)
  t.buffer.active.baseY = 0; t.rows = 3; lines[2] = 'Esc to interrupt'
  expect(terminalHasMenu(t)).toBe(false)
})
it('does not treat startup, an existing draft, a menu, or a busy prompt as ready', () => {
  expect(promptCanReceive(terminal('❯ '), 'claude')).toBe(true)
  expect(promptCanReceive(terminal('> Try "fix lint errors"'), 'claude')).toBe(true)
  expect(promptCanReceive(terminal('› '), 'codex')).toBe(true)
  expect(promptCanReceive(terminal('❯ ', 2, '', false), 'claude')).toBe(false)
  expect(promptCanReceive(terminal('❯ 未提交文字', 7), 'claude')).toBe(false)
  expect(promptCanReceive(terminal('❯ ', 2, 'esc to interrupt'), 'claude')).toBe(false)
  expect(promptCanReceive(terminal('> ', 2, '✽ Whirring… (0s · thinking)'), 'claude')).toBe(false)
  expect(promptCanReceive(terminal('❯ 1. Yes'), 'claude')).toBe(false)
  expect(promptCanReceive(terminal('Allow this action?'), 'codex')).toBe(false)
})
it('does not submit a draft that was concatenated with native text or an unrelated repaint', () => {
  expect(promptHasDraft(terminal('❯ 新问题原生草稿', 8), 'claude', '新问题')).toBe(false)
  expect(promptHasDraft(terminal('> 新问题', 8), 'claude', '新问题')).toBe(true)
})
it('recognizes a CLI image chip replacing a managed path, while rejecting an extra native attachment', () => {
  expect(promptHasDraft(terminal('> [Image #1]图片问题', 15), 'claude', '图片问题\n"C:\\\\image.png"', ['C:\\image.png'])).toBe(true)
  expect(promptHasDraft(terminal('> [Image #1][Image #2]图片问题', 15), 'claude', '图片问题', ['C:\\image.png'])).toBe(false)
})
it('preserves multiline whitespace and separates paste from the single submit event', () => {
  const text = '第一行\r\n\r\n  第二行\r\n'
  const payload = bracketedComposerText(text)
  expect(payload).toBe('\x1b[200~第一行\n\n  第二行\n\x1b[201~')
  const tracker = createConversationInputTracker()
  expect(tracker.push(payload)).toBe(false)
  expect(tracker.push('\r')).toBe(true)
  expect(() => bracketedComposerText('hello\x1b[201~\rdelete')).toThrow()
})
it('references managed paths as prompt text without shell escaping or executing paths', () => {
  expect(composerPayload('查看图片', ['C:\\缓存 图片\\截图.png'])).toBe('查看图片\n请读取以下本地图片文件，再根据图片回答（文件路径）：\n"C:\\\\缓存 图片\\\\截图.png"')
})
it('uses non-submitting Shift+Enter key events for Windows Codex blank lines', () => {
  const payload = composerPaste('a\n\nb', 'codex', true)
  expect(payload).not.toContain('\n')
  expect(payload.match(/13;28;13;1;16;1_/g)).toHaveLength(2)
  expect(payload).not.toContain('\r')
  expect(() => composerPaste('\tcode', 'codex', true)).toThrow('Tab')
  expect(composerPaste('a\nb', 'claude', true)).toContain('\n')
})
it('enables the two additional CLI families while keeping ordinary shells native', () => {
  expect(supportsComposer('antigravity')).toBe(true)
  expect(supportsComposer('opencode')).toBe(true)
  expect(supportsComposer('powershell')).toBe(false)
})

function screen(lines: string[], cursorY: number, cursorX: number) {
  return { rows: lines.length, modes: { bracketedPasteMode: true }, buffer: { active: { baseY: 0, cursorY, cursorX, length: lines.length,
    getLine: (i: number) => ({ translateToString: (trim: boolean) => trim ? (lines[i] ?? '').trimEnd() : (lines[i] ?? '').padEnd(100) }) } } } as any
}
it('recognizes Antigravity empty input and its directory trust menu', () => {
  expect(promptCanReceive(screen(['─────', '>', '─────', '? for shortcuts'], 1, 2), 'antigravity')).toBe(true)
  expect(promptHasDraft(screen(['─────', '> 第一行', '', '  第二行', '─────'], 3, 8), 'antigravity', '第一行\n\n第二行')).toBe(true)
  const menu = screen(['> Yes, I trust this folder', '  No, exit', '  ↑/↓ Navigate · enter Confirm'], 2, 99)
  expect(terminalHasMenu(menu, 'antigravity')).toBe(true)
  expect(promptCanReceive(menu, 'antigravity')).toBe(false)
})
it('recognizes OpenCode editor rails, empty placeholders, and complete collapsed multiline pastes', () => {
  const lines = ['             ┃', '             ┃  Ask anything... "Fix broken tests"', '             ┃', '             ┃  Build · QA', '             ╹────', '             tab agents  ctrl+p commands']
  const t = screen(lines, 1, 16)
  expect(promptCanReceive(t, 'opencode')).toBe(true)
  lines[1] = '             ┃  [Pasted ~3 lines]';t.buffer.active.cursorX = 34
  expect(promptHasDraft(t, 'opencode', '第一行\n\n第二行')).toBe(true)
  expect(promptHasDraft(t, 'opencode', '两行\n文本')).toBe(false)
  expect(promptCanReceive(t, 'opencode')).toBe(false)
  lines[1] = '             ┃  原生草稿';t.buffer.active.cursorX = 16
  expect(promptCanReceive(t, 'opencode')).toBe(false)
})
it('blocks OpenCode busy input and recognizes dialogs whose title ends with Esc', () => {
  const lines = ['┃', '┃  ', '┃', '┃  Build · QA', '╹────', 'tab agents  ctrl+p commands  esc interrupt']
  const t = screen(lines, 1, 3)
  expect(promptCanReceive(t, 'opencode')).toBe(false)
  expect(terminalHasMenu(t, 'opencode')).toBe(false)
  lines[5] = 'Commands                       esc'
  expect(terminalHasMenu(t, 'opencode')).toBe(true)
})
