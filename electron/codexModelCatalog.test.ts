import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildCodexModelCatalog,
  quarantineLegacyCodexModelCache,
  withCodexModelCatalogPath,
  writeCodexModelCatalog,
} from './codexModelCatalog'

describe('Codex 分身模型目录隔离', () => {
  it('生成 Codex 可加载的单模型目录', () => {
    const catalog = JSON.parse(buildCodexModelCatalog('gpt-clone', 'clone-a'))

    expect(catalog.models).toHaveLength(1)
    expect(catalog.models[0]).toMatchObject({
      slug: 'gpt-clone',
      display_name: 'gpt-clone',
      support_verbosity: false,
      supported_in_api: true,
    })
    expect(catalog.models[0].base_instructions).toBeTruthy()
  })

  it('把独立目录的绝对路径写入分身 profile', () => {
    const content = 'model_provider = "ringcode-clone"\nmodel = "gpt-clone"\n'
    const next = withCodexModelCatalogPath(content, 'C:\\Users\\A\\.codex\\ringcode-a.models.json')

    expect(next).toContain('model_catalog_json = "C:\\\\Users\\\\A\\\\.codex\\\\ringcode-a.models.json"')
    expect(next.match(/model_catalog_json/g)).toHaveLength(1)
  })

  it('目录文件按分身归属写入，不覆盖其他文件', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ringcode-model-catalog-'))
    const first = writeCodexModelCatalog({ cloneId: 'clone-a', profileName: 'ringcode-clone-a', model: 'gpt-a' }, home)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(fs.existsSync(first.path)).toBe(true)

    fs.writeFileSync(first.path, '{"models":[]}', 'utf8')
    expect(writeCodexModelCatalog({ cloneId: 'clone-a', profileName: 'ringcode-clone-a', model: 'gpt-b' }, home).ok).toBe(false)
  })

  it('只隔离一次旧全局模型缓存，并保留可恢复备份', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ringcode-model-cache-'))
    const codexDir = path.join(home, '.codex')
    fs.mkdirSync(codexDir, { recursive: true })
    fs.writeFileSync(path.join(codexDir, 'models_cache.json'), '{"models":[{"slug":"clone-only"}]}')
    fs.writeFileSync(path.join(codexDir, 'ringcode-clone-a.config.toml'), 'model_provider = "ringcode-clone"\n')

    const first = quarantineLegacyCodexModelCache(home)
    expect(first).toMatchObject({ ok: true, changed: true })
    if (!first.ok || !first.changed) return
    expect(fs.readFileSync(first.backupPath, 'utf8')).toContain('clone-only')
    expect(fs.existsSync(path.join(codexDir, 'models_cache.json'))).toBe(false)

    fs.writeFileSync(path.join(codexDir, 'models_cache.json'), '{"models":[{"slug":"official"}]}')
    expect(quarantineLegacyCodexModelCache(home)).toMatchObject({ ok: true, changed: false })
    expect(fs.existsSync(path.join(codexDir, 'models_cache.json'))).toBe(true)
  })
})
