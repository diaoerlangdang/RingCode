import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { registerOwnedResource } from './ownedResources'
import { claudeSettingsPath } from './ringcodeHome'

export interface WriteClaudeSettingsInput {
  cloneId: string
  injectKey: 'ANTHROPIC_API_KEY' | 'ANTHROPIC_AUTH_TOKEN'
  env: Record<string, string>
  secret: string
}

export type WriteClaudeSettingsResult = { ok: true; path: string } | { ok: false; reason: string }

export function writeClaudeSettingsOverlay(input: WriteClaudeSettingsInput, home = os.homedir()): WriteClaudeSettingsResult {
  const cloneId = input.cloneId.trim()
  if (!cloneId || /[\\/]/.test(cloneId)) return { ok: false, reason: 'cloneId 无效' }
  if (!input.secret) return { ok: false, reason: '缺少分身密钥' }
  const file = claudeSettingsPath(cloneId, home)
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const env = { ...input.env, [input.injectKey]: input.secret }
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify({ env }, null, 2)}\n`, 'utf8')
    fs.renameSync(tmp, file)
    registerOwnedResource({ kind: 'claudeSettings', path: file, cloneId }, path.join(home, '.ringcode', 'owned-resources.json'))
    return { ok: true, path: file }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
