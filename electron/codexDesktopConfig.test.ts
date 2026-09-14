import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ensureCodexDesktopProviderAlias,
  ensureCodexDesktopProviderAliasIfNeeded,
  hasCodexProviderAlias,
} from './codexDesktopConfig'

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ringcode-codex-desktop-'))
}

describe('Codex 桌面版 provider 兼容配置', () => {
  it('保留用户配置、创建备份，并只追加不改变默认 provider 的托管段', () => {
    const home = tempHome()
    const dir = path.join(home, '.codex')
    const file = path.join(dir, 'config.toml')
    fs.mkdirSync(dir, { recursive: true })
    const original = 'model = "gpt-test"\r\n\r\n[features]\r\nplugins = true\r\n'
    fs.writeFileSync(file, original)

    const result = ensureCodexDesktopProviderAlias(home)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(true)
    expect(result.backupPath).toBeTruthy()
    expect(fs.readFileSync(result.backupPath!, 'utf8')).toBe(original)
    const content = fs.readFileSync(file, 'utf8')
    expect(content.startsWith('model = "gpt-test"')).toBe(true)
    expect(content).toContain('[model_providers.ringcode-clone]')
    expect(content).toContain('requires_openai_auth = true')
    expect(content).not.toMatch(/^model_provider\s*=/m)
    expect(content).toContain('\r\n')
  })

  it('重复执行幂等，并把托管段更新到文件末尾', () => {
    const home = tempHome()
    const first = ensureCodexDesktopProviderAlias(home)
    expect(first.ok).toBe(true)
    const file = path.join(home, '.codex', 'config.toml')
    const content = fs.readFileSync(file, 'utf8')
    fs.writeFileSync(file, `${content}\n[features]\nplugins = true\n`)

    const second = ensureCodexDesktopProviderAlias(home)
    const third = ensureCodexDesktopProviderAlias(home)

    expect(second).toMatchObject({ ok: true, changed: true, source: 'ringcode' })
    expect(third).toMatchObject({ ok: true, changed: false, source: 'ringcode' })
    const updated = fs.readFileSync(file, 'utf8')
    expect(updated.match(/\[model_providers\.ringcode-clone\]/g)).toHaveLength(1)
    expect(updated.indexOf('[features]')).toBeLessThan(updated.indexOf('[model_providers.ringcode-clone]'))
  })

  it('用户已经定义同名 provider 时不覆盖', () => {
    const home = tempHome()
    const dir = path.join(home, '.codex')
    const file = path.join(dir, 'config.toml')
    fs.mkdirSync(dir, { recursive: true })
    const original = '[model_providers."ringcode-clone"]\nbase_url = "https://user.example/v1"\n'
    fs.writeFileSync(file, original)

    const result = ensureCodexDesktopProviderAlias(home)

    expect(result).toMatchObject({ ok: true, changed: false, source: 'user' })
    expect(fs.readFileSync(file, 'utf8')).toBe(original)
    expect(hasCodexProviderAlias('[model_providers]\n"ringcode-clone" = { base_url = "https://x" }\n')).toBe(true)
  })

  it('用户在托管段之外新增同名 provider 时移除托管段并采用用户定义', () => {
    const home = tempHome()
    expect(ensureCodexDesktopProviderAlias(home)).toMatchObject({ ok: true, changed: true })
    const file = path.join(home, '.codex', 'config.toml')
    fs.appendFileSync(file, '\n[model_providers."ringcode-clone"]\nbase_url = "https://user.example/v1"\n')

    const result = ensureCodexDesktopProviderAlias(home)

    expect(result).toMatchObject({ ok: true, changed: true, source: 'user' })
    const content = fs.readFileSync(file, 'utf8')
    expect(content).not.toContain('RingCode managed Codex desktop compatibility')
    expect(content.match(/ringcode-clone/g)).toHaveLength(1)
    expect(content).toContain('https://user.example/v1')
  })

  it('仅在发现 RingCode 所有的 Codex profile 时执行旧用户迁移', () => {
    const home = tempHome()
    expect(ensureCodexDesktopProviderAliasIfNeeded(home)).toBeNull()
    const dir = path.join(home, '.codex')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'ringcode-provider-alias.config.toml'), '# foreign\n')
    expect(ensureCodexDesktopProviderAliasIfNeeded(home)).toBeNull()
    fs.writeFileSync(
      path.join(dir, 'ringcode-provider-alias.config.toml'),
      '# Owned by RingCode. cloneId=codex-provider-alias\n[model_providers.ringcode-clone]\n',
    )

    const result = ensureCodexDesktopProviderAliasIfNeeded(home)

    expect(result).toMatchObject({ ok: true, changed: true, source: 'ringcode' })
    expect(fs.readFileSync(path.join(dir, 'config.toml'), 'utf8')).toContain('[model_providers.ringcode-clone]')
  })

  it('托管标记损坏时停止写入', () => {
    const home = tempHome()
    const dir = path.join(home, '.codex')
    const file = path.join(dir, 'config.toml')
    fs.mkdirSync(dir, { recursive: true })
    const original = '# >>> RingCode managed Codex desktop compatibility >>>\n'
    fs.writeFileSync(file, original)

    const result = ensureCodexDesktopProviderAlias(home)

    expect(result).toMatchObject({ ok: false })
    expect(fs.readFileSync(file, 'utf8')).toBe(original)
  })
})
