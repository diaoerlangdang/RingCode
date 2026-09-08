/** 把 PTY/TUI 原始输出收成可阅读正文（PRD：剥 ANSI 后再展示/索引）。磁盘 jsonl 本身已是纯文本，本机 transcript 则是终端转义流。 */

const ANSI_RE =
  // OSC / CSI / DCS / charset / 残余 ESC。顺序：长序列优先，避免 ESC 被单字节吃掉。
  /\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b\[[0-9;:?]*[ -/]*[@-~]|\x9b[0-9;:?]*[ -/]*[@-~]|\x1b[PX^_][\s\S]*?(?:\x1b\\|\x07)|\x1b[()*+][0-9A-Za-z]|\x1b[NOE78FGHLM=>]|\x1b./g

const BOX = '─━│┃┌┐└┘├┤┬┴┼╭╮╯╰╔╗╚╝║═╠╣╦╩╬▀▄█▌▐░▒▓━■□◆◇▖▗▘▙▚▛▜▝▞▟'
const TITLE_ARROWS = '❯❮▸►▶⟫»›‹'
const STATUS_LINE_RE = /^\s*\[(?:进程已退出|启动失败|process exited|command exited|error launching)[^\]]*\]\s*$/i

export function stripAnsi(input: string): string {
  if (!input) return ''
  return input.replace(ANSI_RE, '')
}

function applyBackspace(s: string): string {
  let out = ''
  for (const ch of s) {
    if (ch === '\b') out = out.slice(0, -1)
    else out += ch
  }
  return out
}

/** 同一行里的 \\r 视为回车覆盖（进度条 / TUI 刷新） */
function applyCarriageReturn(line: string): string {
  if (!line.includes('\r')) return line
  const parts = line.split('\r')
  return parts[parts.length - 1] ?? ''
}

function dropDecorLines(s: string): string {
  return s
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      if (t.length < 2) return true
      let boxes = 0
      for (const ch of t) if (BOX.includes(ch)) boxes++
      return boxes / t.length <= 0.6
    })
    .join('\n')
}

export function cleanTranscript(input: string): string {
  if (!input) return ''
  let s = stripAnsi(input)
  // transcript 被截断后可能从 CSI 颜色参数中间开始，清掉缺少 ESC 前缀的残片。
  s = s.replace(/\b(?:\d{1,3};){2,}\d{1,3}m/g, '')
  s = s.replace(/\r\n/g, '\n')
  s = s
    .split('\n')
    .map((line) => applyBackspace(applyCarriageReturn(line)))
    .join('\n')
  s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
  s = dropDecorLines(s)
  s = s
    .split('\n')
    .filter((line) => !STATUS_LINE_RE.test(line))
    .join('\n')
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

export function cleanTitleText(input: string): string {
  const escaped = `${BOX}${TITLE_ARROWS}`.replace(/[\\\]\-^]/g, '\\$&')
  return cleanTranscript(input)
    .replace(/^\s*(?:user|assistant|claude|codex|system|you|ai|bot)\s*[:>\])]\s*/i, '')
    .replace(new RegExp(`^[\\s>$#%*?•·▪${escaped}]+`), '')
    .replace(new RegExp(`[${escaped}\\s]+$`), '')
    .replace(/[\s*_#~`]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isNoisyTitle(input: string): boolean {
  const value = cleanTitleText(input)
  if (!value) return true
  if (/[�■□]{2,}/.test(input)) return true
  if (/^[a-z]:[\\/]/i.test(value) || /^\/(?:home|users?|mnt|workspace)\//i.test(value)) return true
  if (/^(?:mode\s+normal|last[- ]prompt|session[- _]?id|claude code\s+v?\d)/i.test(value)) return true
  if (/(?:shenaniganing|waiting for api response|auto mode on|welcome back|loading conversations|continue anyway|term is set to|bypasspermissions|shift\+tab|run\s*\/init|churned for|esc to cancel)/i.test(value)) return true
  if (/claude\s*code\s*v?\d/i.test(value)) return true
  if (/<(?:command-name|command-message|local-command|EXTREMELY|system-reminder)/i.test(input)) return true
  if (/you have superpowers|hookSpecificOutput/i.test(input)) return true
  if (/^\s*[{[]/.test(value)) return true
  if (/node_modules[\\/]/i.test(value)) return true
  if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) return true
  return false
}

/** 从会话正文启发式派生标题（HIS-012） */
export function deriveTitle(text: string): string | null {
  const clean = cleanTranscript(text)
  const box = BOX
  const sysLabelRe = /^(warning|error|note|tip|info|debug|trace|notice)[:>\])]/i
  const convoLabelRe = /^(user|assistant|claude|codex|system|you|ai|bot)[:>\])]\s*(.*)$/i
  const hasBox = new RegExp(`[${box}]`)
  const candidates: string[] = []
  for (const raw of clean.split('\n')) {
    let t = cleanTitleText(raw)
    if (t.length < 4 || isNoisyTitle(t)) continue
    if (sysLabelRe.test(t)) continue
    const m = t.match(convoLabelRe)
    if (m) t = m[2].trim()
    if (t.length < 4) continue
    if (hasBox.test(t)) continue
    if (/^[=\-_*~#]+$/.test(t)) continue
    candidates.push(t)
  }
  if (candidates.length === 0) return null
  const multi = candidates.find((c) => c.split(/\s+/).length >= 2)
  const pick = multi ?? candidates[0]
  if (pick.length <= 48) return pick
  const cut = pick.slice(0, 48)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut) + '…'
}

/** 列表/卡片标题：旧数据里可能仍含 ESC，展示时再剥一层 */
export function displayTitle(title: string, transcript?: string): string {
  const cleaned = cleanTitleText(title)
  const noisy = isNoisyTitle(title)
  if (!noisy && cleaned.length >= 4) return cleaned.length <= 48 ? cleaned : `${cleaned.slice(0, 47)}…`
  const derived = transcript ? deriveTitle(transcript) : null
  if (derived) return derived
  return noisy ? '未命名会话' : cleaned || '未命名会话'
}

export function displaySnippet(transcript: string, max = 160): string {
  const clean = cleanTranscript(transcript)
  if (!clean) return ''
  const line = clean.split('\n').find((l) => l.trim().length >= 4) ?? clean
  const t = line.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max)}…`
}
