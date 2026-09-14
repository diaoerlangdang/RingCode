import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { writeClaudeSettingsOverlay } = await import('./claudeSettingsWrite')

describe('writeClaudeSettingsOverlay', () => {
  it('writes clone settings under .ringcode and injects the secret', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ringcode-claude-settings-'))
    const result = writeClaudeSettingsOverlay(
      {
        cloneId: 'clone-a',
        injectKey: 'ANTHROPIC_AUTH_TOKEN',
        env: { ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_BASE_URL: 'https://api.xiaomimimo.com/anthropic' },
        secret: 'clone-secret',
      },
      home,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const parsed = JSON.parse(readFileSync(result.path, 'utf8')) as { env: Record<string, string> }
    expect(result.path.replace(/\\/g, '/')).toContain('/claude-settings/clone-a.json')
    expect(parsed.env.ANTHROPIC_BASE_URL).toBe('https://api.xiaomimimo.com/anthropic')
    expect(parsed.env.ANTHROPIC_AUTH_TOKEN).toBe('clone-secret')
    expect(parsed.env.ANTHROPIC_API_KEY).toBe('')
  })
})
