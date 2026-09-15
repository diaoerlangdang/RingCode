import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { removeLegacyCodexDesktopProviderAlias } from './codexDesktopConfig'

const START = '# >>> RingCode managed Codex desktop compatibility >>>'
const END = '# <<< RingCode managed Codex desktop compatibility <<<'

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ringcode-codex-desktop-'))
}

describe('Codex 桌面版旧兼容配置清理', () => {
  it('只移除 RingCode 托管段并完整保留原配置', () => {
    const home = tempHome()
    const dir = path.join(home, '.codex')
    const file = path.join(dir, 'config.toml')
    fs.mkdirSync(dir, { recursive: true })
    const original = `model = ${JSON.stringify('gpt-test')}\r\n\r\n[features]\r\nplugins = true\r\n`
    fs.writeFileSync(
      file,
      `${original}\r\n${START}\r\n[model_providers.ringcode-clone]\r\nbase_url = ${JSON.stringify('https://api.openai.com/v1')}\r\n${END}\r\n`,
    )

    const result = removeLegacyCodexDesktopProviderAlias(home)

    expect(result).toMatchObject({ ok: true, changed: true })
    expect(fs.readFileSync(file, 'utf8')).toBe(original)
  })

  it('没有主配置时不创建文件，重复执行保持幂等', () => {
    const home = tempHome()
    const file = path.join(home, '.codex', 'config.toml')

    expect(removeLegacyCodexDesktopProviderAlias(home)).toMatchObject({ ok: true, changed: false })
    expect(fs.existsSync(file)).toBe(false)
    expect(removeLegacyCodexDesktopProviderAlias(home)).toMatchObject({ ok: true, changed: false })
  })

  it('保留托管段之外的用户自定义 provider', () => {
    const home = tempHome()
    const dir = path.join(home, '.codex')
    const file = path.join(dir, 'config.toml')
    fs.mkdirSync(dir, { recursive: true })
    const userProvider = `[model_providers.user-owned]\nbase_url = ${JSON.stringify('https://user.example/v1')}\n`
    fs.writeFileSync(file, `${userProvider}\n${START}\nlegacy = true\n${END}\n`)

    expect(removeLegacyCodexDesktopProviderAlias(home)).toMatchObject({ ok: true, changed: true })
    expect(fs.readFileSync(file, 'utf8')).toBe(userProvider)
  })

  it('托管标记损坏时不改写文件', () => {
    const home = tempHome()
    const dir = path.join(home, '.codex')
    const file = path.join(dir, 'config.toml')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, `${START}\n`)

    expect(removeLegacyCodexDesktopProviderAlias(home)).toMatchObject({ ok: false })
    expect(fs.readFileSync(file, 'utf8')).toBe(`${START}\n`)
  })
})
