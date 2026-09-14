import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const CODEX_OFFICIAL_BASE_URL = 'https://api.openai.com/v1'
const MANAGED_START = '# >>> RingCode managed Codex desktop compatibility >>>'
const MANAGED_END = '# <<< RingCode managed Codex desktop compatibility <<<'

export type CodexDesktopCompatibilityResult =
  | { ok: true; changed: boolean; path: string; backupPath?: string; source: 'ringcode' | 'user' }
  | { ok: false; path: string; reason: string }

function configPath(home: string): string {
  return path.join(home, '.codex', 'config.toml')
}

function managedBlock(eol: string): string {
  return [
    MANAGED_START,
    '# Allows Codex desktop to resume sessions created by RingCode Codex clones.',
    '[model_providers.ringcode-clone]',
    'name = "RingCode clone"',
    `base_url = "${CODEX_OFFICIAL_BASE_URL}"`,
    'wire_api = "responses"',
    'requires_openai_auth = true',
    MANAGED_END,
  ].join(eol)
}

function providerKeyPattern(): string {
  return '(?:ringcode-clone|"ringcode-clone"|\'ringcode-clone\')'
}

/** Conservatively detects a user-owned definition so RingCode never overwrites it. */
export function hasCodexProviderAlias(content: string): boolean {
  const key = providerKeyPattern()
  const directTable = new RegExp(`^\\s*\\[\\s*model_providers\\s*\\.\\s*${key}\\s*\\]\\s*(?:#.*)?$`)
  const dottedAssignment = new RegExp(`^\\s*model_providers\\s*\\.\\s*${key}\\s*(?:\\.|=)`)
  const aliasAssignment = new RegExp(`^\\s*${key}\\s*=`)
  let inProvidersTable = false

  for (const line of content.split(/\r?\n/)) {
    if (directTable.test(line) || dottedAssignment.test(line)) return true
    const table = line.match(/^\s*\[\s*([^\]]+)\s*\]\s*(?:#.*)?$/)
    if (table) {
      inProvidersTable = table[1]?.trim() === 'model_providers'
      continue
    }
    if (inProvidersTable && aliasAssignment.test(line)) return true
  }
  return false
}

function removeManagedBlock(content: string): { content: string; found: boolean } | { reason: string } {
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  const starts = lines.flatMap((line, index) => (line.trim() === MANAGED_START ? [index] : []))
  const ends = lines.flatMap((line, index) => (line.trim() === MANAGED_END ? [index] : []))
  if (starts.length === 0 && ends.length === 0) return { content, found: false }
  if (starts.length !== 1 || ends.length !== 1 || starts[0]! >= ends[0]!) {
    return { reason: 'RingCode 管理的 Codex 兼容配置标记不完整，已停止写入' }
  }
  lines.splice(starts[0]!, ends[0]! - starts[0]! + 1)
  return { content: lines.join(eol), found: true }
}

function nextBackupPath(file: string): string {
  const base = `${file}.ringcode.bak`
  if (!fs.existsSync(base)) return base
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${base}.${index}`
    if (!fs.existsSync(candidate)) return candidate
  }
  throw new Error('Codex 配置备份文件过多')
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

export function ensureCodexDesktopProviderAlias(home = os.homedir()): CodexDesktopCompatibilityResult {
  const file = configPath(home)
  try {
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    const withoutManaged = removeManagedBlock(existing)
    if ('reason' in withoutManaged) return { ok: false, path: file, reason: withoutManaged.reason }
    if (hasCodexProviderAlias(withoutManaged.content)) {
      if (!withoutManaged.found) return { ok: true, changed: false, path: file, source: 'user' }
      const restored = withoutManaged.content.trimEnd()
      writeAtomic(file, restored ? `${restored}${existing.includes('\r\n') ? '\r\n' : '\n'}` : '')
      return { ok: true, changed: true, path: file, source: 'user' }
    }

    const eol = existing.includes('\r\n') ? '\r\n' : '\n'
    const prefix = withoutManaged.content.trimEnd()
    const next = `${prefix}${prefix ? `${eol}${eol}` : ''}${managedBlock(eol)}${eol}`
    if (next === existing) return { ok: true, changed: false, path: file, source: 'ringcode' }

    fs.mkdirSync(path.dirname(file), { recursive: true })
    let backupPath: string | undefined
    if (existing && !withoutManaged.found) {
      backupPath = nextBackupPath(file)
      fs.copyFileSync(file, backupPath, fs.constants.COPYFILE_EXCL)
    }
    writeAtomic(file, next)
    return { ok: true, changed: true, path: file, backupPath, source: 'ringcode' }
  } catch (error) {
    return { ok: false, path: file, reason: error instanceof Error ? error.message : String(error) }
  }
}

function isOwnedRingCodeProfile(file: string): boolean {
  try {
    const content = fs.readFileSync(file, 'utf8')
    return content.includes('Owned by RingCode.') && content.includes('[model_providers.ringcode-clone]')
  } catch {
    return false
  }
}

/** Existing users are migrated on startup only when a RingCode Codex profile proves the feature was used. */
export function ensureCodexDesktopProviderAliasIfNeeded(home = os.homedir()): CodexDesktopCompatibilityResult | null {
  const dir = path.join(home, '.codex')
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return null
  }
  const hasOwnedProfile = names.some(
    (name) => /^ringcode-[a-zA-Z0-9-]+\.config\.toml$/.test(name) && isOwnedRingCodeProfile(path.join(dir, name)),
  )
  return hasOwnedProfile ? ensureCodexDesktopProviderAlias(home) : null
}
