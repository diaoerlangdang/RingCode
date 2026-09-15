import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeCodexOverlay } from './codexOverlayWrite'
import { listOwnedResources } from './ownedResources'

describe('Codex overlay 归属写入', () => {
  it('只覆盖带本分身标记的文件，并登记归属', () => {
    const root = path.join(os.tmpdir(), `ringcode-overlay-${process.pid}-${Date.now()}`)
    const cloneId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    const content = `# Owned by RingCode. cloneId=${cloneId}\nmodel_provider = "ringcode-clone"\n`
    const first = writeCodexOverlay({ cloneId, profileName: `ringcode-${cloneId}`, content }, root)
    expect(first.ok).toBe(true)
    const second = writeCodexOverlay({ cloneId, profileName: `ringcode-${cloneId}`, content: `${content}model = "x"\n` }, root)
    expect(second.ok).toBe(true)
    expect(fs.existsSync(path.join(root, '.codex', 'config.toml'))).toBe(false)
    const foreign = writeCodexOverlay(
      { cloneId: 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee', profileName: `ringcode-${cloneId}`, content: `# Owned by RingCode. cloneId=bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee\n` },
      root,
    )
    expect(foreign.ok).toBe(false)
    const owned = listOwnedResources(path.join(root, '.ringcode', 'owned-resources.json'))
    expect(owned.some((item) => item.kind === 'codexOverlay' && item.cloneId === cloneId)).toBe(true)
  })

  it('写入分身 profile 时不修改用户主配置', () => {
    const root = path.join(os.tmpdir(), `ringcode-overlay-main-config-${process.pid}-${Date.now()}`)
    const codexDir = path.join(root, '.codex')
    const mainConfig = path.join(codexDir, 'config.toml')
    const original = `model = ${JSON.stringify('gpt-6-astra')}\n`
    fs.mkdirSync(codexDir, { recursive: true })
    fs.writeFileSync(mainConfig, original)
    const cloneId = 'cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee'

    const result = writeCodexOverlay(
      {
        cloneId,
        profileName: `ringcode-${cloneId}`,
        content: `# Owned by RingCode. cloneId=${cloneId}\nmodel_provider = ${JSON.stringify('ringcode-clone')}\n`,
      },
      root,
    )

    expect(result.ok).toBe(true)
    expect(fs.readFileSync(mainConfig, 'utf8')).toBe(original)
  })
})
