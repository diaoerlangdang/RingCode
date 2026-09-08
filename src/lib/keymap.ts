/** 将 "Ctrl+Shift+1" 这类规格与键盘事件比对 */

const MOD = new Set(['ctrl', 'control', 'shift', 'alt', 'meta', 'cmd', 'command'])

export function parseShortcut(spec: string): { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean; key: string } {
  const parts = spec
    .toLowerCase()
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  const key = parts.filter((p) => !MOD.has(p)).join('') || ''
  return {
    ctrl: parts.includes('ctrl') || parts.includes('control'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    meta: parts.includes('meta') || parts.includes('cmd') || parts.includes('command'),
    key,
  }
}

export function matchShortcut(e: KeyboardEvent, spec: string): boolean {
  if (!spec) return false
  const s = parseShortcut(spec)
  if (!!e.ctrlKey !== s.ctrl) return false
  if (!!e.shiftKey !== s.shift) return false
  if (!!e.altKey !== s.alt) return false
  if (!!e.metaKey !== s.meta) return false
  const key = e.key.toLowerCase()
  const code = e.code.toLowerCase()
  if (!s.key) return false
  if (key === s.key) return true
  if (s.key.length === 1 && /^digit\d$/.test(code) && code.endsWith(s.key)) return true
  if (s.key.length === 1 && /^numpad\d$/.test(code) && code.endsWith(s.key)) return true
  if (s.key === 'p' && (key === 'p' || code === 'keyp')) return true
  return false
}

export const DEFAULT_KEYMAP: Record<string, string> = {
  'ai.claude': 'Ctrl+Shift+1',
  'ai.codex': 'Ctrl+Shift+2',
  'ai.opencode': 'Ctrl+Shift+3',
  'ai.antigravity': 'Ctrl+Shift+4',
  'ai.hermes': 'Ctrl+Shift+5',
  'ai.history': 'Ctrl+Shift+H',
  'terminal.new': 'Ctrl+Shift+T',
  'file.search': 'Ctrl+Shift+F',
  'file.quickOpen': 'Ctrl+P',
  'view.toggleLeft': 'Ctrl+B',
  'view.toggleRight': 'Ctrl+Alt+B',
  'view.toggleBottom': 'Ctrl+J',
  'view.commandPalette': 'Ctrl+Shift+P',
}
