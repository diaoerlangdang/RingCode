const MAX_TITLE_CHARS = 80

/** 过长、hook 倾倒、路径清单等不能当会话标题。 */
export function isUsableHistoryTitle(input: string): boolean {
  const value = input.replace(/\s+/g, ' ').trim()
  if (value.length < 2) return false
  if (/[�]/.test(input)) return false
  if (/<(?:command-name|command-message|local-command|EXTREMELY|system-reminder)/i.test(input)) return false
  if (/you have superpowers/i.test(input)) return false
  if (/hookSpecificOutput|additionalContext/i.test(input)) return false
  if (/^\s*[{[]/.test(value)) return false
  if (/^[a-z]:[\\/]/i.test(value) || /^\/(?:home|users?|mnt|workspace)\//i.test(value)) return false
  if (/node_modules[\\/]/i.test(value)) return false
  if (/^(?:mode\s+normal|last[- ]prompt|session[- _]?id|claude code\s+v?\d)/i.test(value)) return false
  if (/(?:waiting for api response|auto mode on|welcome back|bypasspermissions)/i.test(value)) return false
  return true
}

export function compactHistoryTitle(input: string, max = MAX_TITLE_CHARS): string {
  const line = input
    .split(/\r?\n/)
    .map((row) => row.trim())
    .find((row) => row.length >= 2) ?? input.replace(/\s+/g, ' ').trim()
  const value = line.replace(/\s+/g, ' ').trim()
  if (!value) return ''
  if (value.length <= max) return value
  const cut = value.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${lastSpace > 20 ? cut.slice(0, lastSpace) : cut}…`
}

export function selectHistoryTitle(cliTitle: string, firstUserText: string, fallbackText: string): string {
  for (const raw of [cliTitle, firstUserText, fallbackText]) {
    if (!isUsableHistoryTitle(raw)) continue
    return compactHistoryTitle(raw)
  }
  return ''
}
