import type { Terminal } from '@xterm/xterm'
import { promptCanReceive, promptHasDraft, terminalHasMenu } from './terminalComposer'

export interface NativeInputRegion {
  startRow: number; endRow: number; startColumn: number; endColumn: number
}
export interface PendingNativeInput { text: string; paths: string[] }

/** Buffer coordinates stay intact: these regions affect only presentation and copying. */
export function nativeInputRegions(term: Pick<Terminal, 'buffer' | 'modes' | 'rows' | 'cols'>, family: string, pending?: PendingNativeInput): NativeInputRegion[] {
  if (!term.modes.bracketedPasteMode || terminalHasMenu(term, family)) return []
  const b = term.buffer.active, cursor = b.baseY + b.cursorY
  const line = (row: number) => b.getLine(row)?.translateToString(true) ?? ''
  const region = (startRow: number, endRow: number, startColumn = 0, endColumn = term.cols) => ({ startRow, endRow, startColumn, endColumn })
  const pasted = !!pending && promptHasDraft(term, family, pending.text, pending.paths)
  if (family === 'opencode') {
    for (let bottom = b.baseY; bottom < Math.min(b.length, b.baseY + term.rows); bottom++) {
      const border = line(bottom).match(/^(\s*)[╹└┗╰][▀─━-]{4,}/)
      if (!border || !/ctrl\+p\s+commands|esc\s+(?:again\s+)?(?:to\s+)?interrupt/i.test(line(bottom + 1))) continue
      const column = border[1].length, rail = new RegExp(`^ {${column}}[┃|]`)
      let top = bottom - 1
      while (top >= b.baseY && rail.test(line(top))) top--
      top++
      const metadata = bottom - 1
      if (top >= metadata || !/\S\s+·\s+\S/.test(line(metadata))) continue
      const input = Array.from({ length: metadata - top }, (_, i) => line(top + i).slice(column + 1, border[0].length).trim()).join('\n').trim()
      if (input && !/^Ask anything(?:…|\.{3})(?:\s+"[\s\S]+")?$/.test(input) && !pasted) continue
      const hints = line(bottom + 1).match(/^\s*tab\s+agents\s+ctrl\+p\s+commands/i)
      return [region(top, metadata - 1, column, border[0].length), region(metadata, metadata, column, column + 1), region(bottom, bottom, column, border[0].length),
        ...(hints ? [region(bottom + 1, bottom + 1, column, hints[0].length)] : [])]
    }
    return []
  }
  if (!['claude', 'codex', 'antigravity'].includes(family)) return []
  const marker = family === 'codex' ? '›' : '[❯>]'
  const prompt = new RegExp(`^\\s*${marker}\\s*`)
  for (let row = cursor; row >= Math.max(b.baseY, cursor - 30); row--) {
    if (!prompt.test(line(row))) continue
    const input = line(row).replace(prompt, '').trim()
    const empty = !input || (family === 'claude' && /^Try ".+"$/.test(input))
      || (family === 'antigravity' && /^Describe your next engineering task here(?:…|\.{3})$/.test(input))
      || (row === cursor && promptCanReceive(term, family))
    if (!empty && !pasted) return []
    const horizontal = (value: string) => /^\s*[─━═-]{4,}\s*$/.test(value)
    if (row > b.baseY && horizontal(line(row - 1))) {
      for (let bottom = row + 1; bottom < Math.min(b.length, row + 32); bottom++) {
        if (horizontal(line(bottom))) {
          if (cursor > bottom && (cursor > bottom + 2 || !/\?\s+for\s+shortcuts|esc\s+.*interrupt|(?:gemini|claude|gpt).*·/i.test(line(bottom + 1)))) return []
          const hints = line(bottom + 1).match(/^\s*\?\s+for\s+shortcuts/i)
          return [region(row - 1, bottom), ...(hints ? [region(bottom + 1, bottom + 1, 0, hints[0].length)] : [])]
        }
      }
      return []
    }
    return row === cursor || pasted ? [region(row, cursor)] : []
  }
  return []
}

/** Exclude covered input cells when a selection crosses the live input area. */
export function visibleTerminalSelection(term: Pick<Terminal, 'buffer' | 'cols' | 'getSelection' | 'getSelectionPosition'>, regions: NativeInputRegion[]): string {
  const original = term.getSelection(), selection = term.getSelectionPosition()
  if (!selection || !regions.some((r) => r.startRow <= selection.end.y && r.endRow >= selection.start.y)) return original
  const lines: string[] = []
  for (let row = selection.start.y; row <= selection.end.y; row++) {
    const start = row === selection.start.y ? selection.start.x : 0, end = row === selection.end.y ? selection.end.x : term.cols
    const bufferLine = term.buffer.active.getLine(row)
    let segments = [[start, end]]
    for (const r of regions.filter((r) => row >= r.startRow && row <= r.endRow)) {
      segments = segments.flatMap(([a, z]) => r.endColumn <= a || r.startColumn >= z ? [[a, z]] : [[a, Math.max(a, r.startColumn)], [Math.min(z, r.endColumn), z]].filter(([a, z]) => z > a))
    }
    if (!segments.length) continue
    const text = segments.map(([a, z]) => bufferLine?.translateToString(true, a, z) ?? '').join('')
    if (bufferLine?.isWrapped && lines.length) lines[lines.length - 1] += text
    else lines.push(text)
  }
  return lines.join(original.includes('\r\n') ? '\r\n' : '\n').replace(/\u00a0/g, ' ')
}
