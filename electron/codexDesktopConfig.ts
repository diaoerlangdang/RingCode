import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const MANAGED_START = '# >>> RingCode managed Codex desktop compatibility >>>'
const MANAGED_END = '# <<< RingCode managed Codex desktop compatibility <<<'

export type CodexDesktopCleanupResult =
  | { ok: true; changed: boolean; path: string }
  | { ok: false; path: string; reason: string }

function configPath(home: string): string {
  return path.join(home, '.codex', 'config.toml')
}

function removeManagedBlock(content: string): { content: string; found: boolean } | { reason: string } {
  const starts = [...content.matchAll(new RegExp(`^${MANAGED_START}$`, 'gm'))]
  const ends = [...content.matchAll(new RegExp(`^${MANAGED_END}$`, 'gm'))]
  if (starts.length === 0 && ends.length === 0) return { content, found: false }
  if (starts.length !== 1 || ends.length !== 1 || starts[0]!.index >= ends[0]!.index) {
    return { reason: 'RingCode 管理的 Codex 桌面兼容配置标记不完整，已停止清理' }
  }

  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  let removeStart = starts[0]!.index
  let removeEnd = ends[0]!.index + MANAGED_END.length

  // The legacy writer inserted one blank separator before the managed block.
  if (content.slice(0, removeStart).endsWith(`${eol}${eol}`)) removeStart -= eol.length
  if (content.slice(removeEnd).startsWith(eol)) removeEnd += eol.length

  return { content: `${content.slice(0, removeStart)}${content.slice(removeEnd)}`, found: true }
}

function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.tmp`
  try {
    fs.writeFileSync(tmp, content, 'utf8')
    fs.renameSync(tmp, file)
  } catch (error) {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* missing or already replaced */
    }
    throw error
  }
}

/** Removes only the global provider block written by RingCode 0.4.1. */
export function removeLegacyCodexDesktopProviderAlias(home = os.homedir()): CodexDesktopCleanupResult {
  const file = configPath(home)
  try {
    if (!fs.existsSync(file)) return { ok: true, changed: false, path: file }
    const existing = fs.readFileSync(file, 'utf8')
    const cleaned = removeManagedBlock(existing)
    if ('reason' in cleaned) return { ok: false, path: file, reason: cleaned.reason }
    if (!cleaned.found) return { ok: true, changed: false, path: file }
    writeAtomic(file, cleaned.content)
    return { ok: true, changed: true, path: file }
  } catch (error) {
    return { ok: false, path: file, reason: error instanceof Error ? error.message : String(error) }
  }
}
