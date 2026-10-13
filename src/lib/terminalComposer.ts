import type { Terminal } from '@xterm/xterm'

export const supportsComposer = (family?: string): boolean => ['claude', 'codex', 'antigravity', 'opencode'].includes(family ?? '')

const promptMarker = (family: string) => family === 'opencode' ? '[┃|]' : family === 'codex' ? '›' : '[❯>]'

/** OpenCode renders each line of its editor behind a rail instead of a prompt character. */
function openCodeDraft(term: Pick<Terminal, 'buffer'>): string | undefined {
  const b = term.buffer.active, row = b.baseY + b.cursorY
  const prefix = /^\s*[┃|]\s? ?/
  if (!prefix.test(b.getLine(row)?.translateToString(true) ?? '')) return undefined
  let start = row
  while (start > Math.max(b.baseY, row - 30) && prefix.test(b.getLine(start - 1)?.translateToString(true) ?? '')) start--
  return Array.from({ length: row - start + 1 }, (_, i) =>
    (b.getLine(start + i)?.translateToString(true) ?? '').replace(prefix, ''),
  ).join('\n').trim()
}

/** Inspect the live screen, not the user's scrolled history, for a CLI confirmation menu. */
export function terminalHasMenu(term: Pick<Terminal, 'buffer' | 'rows'>, family?: string): boolean {
  const b = term.buffer.active
  const lines = Array.from({ length: Math.min(term.rows, b.length - b.baseY) }, (_, i) =>
    b.getLine(b.baseY + i)?.translateToString(true) ?? '',
  )
  if (family === 'opencode' && lines.some((line) => /\besc\s+(?:to\s+)?(?:close|cancel|reject)\b/i.test(line)
    || /^\s*\S.*\s{2,}esc\s*$/i.test(line))) return true
  const footer = lines.findIndex((line, i) =>
    (/^\s*(?:press\s+)?enter\s+(?:to\s+)?(?:confirm|select|continue)\b/i.test(line)
      && /\besc\s+(?:to\s+)?(?:cancel|exit|close)\b/i.test(line + ' ' + (lines[i + 1] ?? '')))
    || /↑\s*\/\s*↓\s+(?:to\s+)?navigate.*\benter\s+(?:to\s+)?confirm\b/i.test(line))
  return footer >= 0 && lines.slice(0, footer).some((line) => /^\s*[>❯›]\s+\S/.test(line))
    && !lines.slice(footer + 1).some((line) => /^\s*[>❯›]\s*$/.test(line))
}

/** Only a known, empty prompt is eligible. A running process alone is insufficient. */
export function promptCanReceive(term: Pick<Terminal, 'buffer' | 'modes'>, family: string): boolean {
  if (!term.modes.bracketedPasteMode) return false
  const buffer = term.buffer.active
  const row = buffer.baseY + buffer.cursorY
  const bufferLine = buffer.getLine(row)
  // Some TUIs position the caret after an unprinted space following the prompt marker.
  const line = bufferLine?.translateToString(false) ?? ''
  const marker = promptMarker(family)
  const match = line.match(new RegExp(`^\\s*${marker}\\s*`))
  if (!match || buffer.cursorX > match[0].length) return false
  // Codex's placeholder is dim text beyond the cursor, rather than editable input.
  if (line.slice(match[0].length).trim()) {
    if (family === 'claude' || family === 'antigravity') {
      // NO_COLOR removes placeholder styling. Its native input cursor remains before the hint.
      const hint = line.slice(match[0].length).trim()
      if (family === 'claude' ? !/^Try ".+"$/.test(hint) : !/^Describe your next engineering task here(?:…|\.{3})$/.test(hint)) return false
    } else if (family === 'opencode') {
      if (!/^Ask anything(?:…|\.{3})(?:\s+".+")?$/.test(line.slice(match[0].length).trim())) return false
    } else {
      for (let i = match[0].length; i < line.length; i++) {
        const cell = bufferLine?.getCell(i)
        if (cell?.getChars().trim() && !cell.isDim()) return false
      }
    }
  }
  const footer = Array.from({ length: buffer.length - buffer.baseY }, (_, i) =>
    buffer.getLine(buffer.baseY + i)?.translateToString(true) ?? '',
  ).join('\n')
  if (family === 'opencode') {
    const draft = openCodeDraft(term)
    if (draft === undefined || (draft && !/^Ask anything(?:…|\.{3})(?:\s+".+")?$/.test(draft))) return false
    if (!/ctrl\+p\s+commands/i.test(footer)) return false
  }
  return !/esc\s+(?:again\s+)?(?:to\s+)?(?:interrupt|cancel|close|reject)|press\s+enter\s+to\s+confirm|↑\s*\/\s*↓\s+navigate.*enter\s+confirm|^[\s]*[✽✻✶✢*]\s+.+….*(?:thinking|\d+s)/im.test(footer)
}

/** A repaint alone is not sufficient: the pasted draft must appear at the input cursor. */
export function promptHasDraft(term: Pick<Terminal, 'buffer' | 'modes'>, family: string, text: string, imagePaths: string[] = []): boolean {
  const b = term.buffer.active, row = b.baseY + b.cursorY
  const marker = promptMarker(family)
  const startsPrompt = (line: string) => new RegExp(`^\\s*${marker}\\s`).test(line)
  const lines: string[] = []
  for (let i = row; i >= Math.max(b.baseY, row - 30); i--) {
    const line = b.getLine(i)?.translateToString(true) ?? ''
    lines.unshift(line)
    if (startsPrompt(line)) break
  }
  if (!lines[0] || !startsPrompt(lines[0])) return false
  const input = family === 'opencode' ? openCodeDraft(term) ?? '' : lines.join('\n').replace(new RegExp(`^\\s*${marker}\\s*`), '').trim()
  // Some CLI versions convert a pasted image path into a native image chip.
  const chips = [...input.matchAll(/\[Image #\d+\]/g)]
  if (chips.length > imagePaths.length) return false
  const compact = (value: string) => {
    let result = value.replace(/\[Image #\d+\]/g, '').replace(/\s/g, '')
    for (const path of imagePaths) result = result.replace(JSON.stringify(path).replace(/\s/g, ''), '')
    return result
  }
  const openCodePaste = family === 'opencode' && input.match(/^\[Pasted ~([0-9]+) lines\]$/)
  return !!input && (compact(input) === compact(text) || /^\[Pasted text\s*(?:#\d+)?\s*\+?\d*\s*lines?\]$/i.test(input)
    || (!!openCodePaste && Number(openCodePaste[1]) === text.trim().split('\n').length))
}

export function composerPayload(text: string, paths: string[]): string {
  const normalized = text.replace(/\r\n?/g, '\n')
  return paths.length
    ? [normalized, '请读取以下本地图片文件，再根据图片回答（文件路径）：', ...paths.map((p) => JSON.stringify(p))].filter(Boolean).join('\n')
    : normalized
}

/** Bracketed paste must finish before the separate submit event. */
export function bracketedComposerText(text: string): string {
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw new Error('输入含有终端控制字符，请移除后再发送')
  return `\x1b[200~${text.replace(/\r\n?/g, '\n')}\x1b[201~`
}

/** ConPTY's native Codex key reader drops bare LF. Encode Shift+Enter as Win32 key events. */
export function composerPaste(text: string, family: string, windows: boolean): string {
  const paste = bracketedComposerText(text)
  if (family !== 'codex' || !windows) return paste
  if (text.includes('\t')) throw new Error('Windows Codex 将 Tab 作为提交快捷键；请将缩进改为空格后发送，草稿已保留')
  return paste.replace(/\n/g, '\x1b[13;28;13;1;16;1_\x1b[13;28;13;0;16;1_')
}
