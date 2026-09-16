import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { registerOwnedResource } from './ownedResources'
import { ownedResourcesPath, ringcodeHome } from './ringcodeHome'

const CATALOG_MARKER = 'RingCode isolated model catalog'
const CACHE_MIGRATION_MARKER = 'codex-model-cache-isolated-v1'
const CACHE_BACKUP_NAME = 'models_cache.json.ringcode-before-catalog-isolation.bak'

interface CatalogInput {
  cloneId: string
  profileName: string
  model: string
}

export type WriteCatalogResult = { ok: true; path: string } | { ok: false; reason: string }

export type CacheQuarantineResult =
  | { ok: true; changed: false }
  | { ok: true; changed: true; backupPath: string }
  | { ok: false; changed: false; reason: string }

function fallbackModel(model: string, cloneId: string): Record<string, unknown> {
  return {
    slug: model,
    display_name: model,
    description: `${CATALOG_MARKER} for ${cloneId}`,
    base_instructions: 'You are Codex, a coding agent. Follow the supplied developer and user instructions.',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [
      { effort: 'none', description: 'No configurable reasoning' },
      { effort: 'low', description: 'Low reasoning' },
      { effort: 'medium', description: 'Medium reasoning' },
      { effort: 'high', description: 'High reasoning' },
      { effort: 'xhigh', description: 'Extra high reasoning' },
    ],
    shell_type: 'unified_exec',
    visibility: 'list',
    supported_in_api: true,
    priority: 0,
    additional_speed_tiers: [],
    service_tiers: [],
    availability_nux: null,
    upgrade: null,
    model_messages: null,
    include_skills_usage_instructions: false,
    include_plugin_usage_instructions: false,
    include_apps_usage_instructions: false,
    default_reasoning_summary: 'none',
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: 'freeform',
    web_search_tool_type: 'text',
    truncation_policy: { mode: 'tokens', limit: 10000 },
    supports_image_detail_original: false,
    context_window: 200000,
    max_context_window: 200000,
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
    input_modalities: ['text'],
    supports_search_tool: false,
    supports_experimental_context: false,
    use_responses_lite: false,
    node_repl_auto_review_required: false,
    node_repl_disabled: false,
  }
}

function readTemplateModel(home: string, model: string): Record<string, unknown> | undefined {
  const codexDir = path.join(home, '.codex')
  const candidates = [path.join(codexDir, 'models_cache.json'), path.join(codexDir, CACHE_BACKUP_NAME)]
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { models?: Array<Record<string, unknown>> }
      const models = Array.isArray(parsed.models) ? parsed.models : []
      const exact = models.find((item) => item.slug === model)
      if (exact && typeof exact.slug === 'string') return exact
    } catch {
      /* missing or invalid cache */
    }
  }
  return undefined
}

export function buildCodexModelCatalog(
  model: string,
  cloneId: string,
  template?: Record<string, unknown>,
): string {
  const cleanModel = model.trim() || 'gpt-5'
  const base = { ...fallbackModel(cleanModel, cloneId), ...(template ?? {}) }
  const entry: Record<string, unknown> = {
    ...base,
    slug: cleanModel,
    display_name: cleanModel,
    description: `${CATALOG_MARKER} for ${cloneId}`,
  }
  const messages = entry.model_messages as { instructions_template?: string } | null | undefined
  if (!entry.base_instructions && !messages?.instructions_template) {
    entry.base_instructions = 'You are Codex, a coding agent. Follow the supplied developer and user instructions.'
  }
  return `${JSON.stringify({ models: [entry] }, null, 2)}\n`
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function withCodexModelCatalogPath(content: string, catalogPath: string, model?: string): string {
  const lines = content.replace(/^model_catalog_json\s*=.*(?:\r?\n)?/gm, '').trimEnd().split(/\r?\n/)
  const providerIndex = lines.findIndex((line) => /^model_provider\s*=/.test(line))
  const insertAt = providerIndex >= 0 ? providerIndex + 1 : 0
  const additions = [`model_catalog_json = ${tomlString(catalogPath)}`]
  if (model?.trim() && !lines.some((line) => /^model\s*=/.test(line))) additions.push(`model = ${tomlString(model.trim())}`)
  lines.splice(insertAt, 0, ...additions)
  return `${lines.join('\n')}\n`
}

function catalogOwnedBy(content: string, cloneId: string): boolean {
  return content.includes(`${CATALOG_MARKER} for ${cloneId}`)
}

export function writeCodexModelCatalog(input: CatalogInput, home = os.homedir()): WriteCatalogResult {
  if (!input.cloneId || !/^ringcode-[a-zA-Z0-9-]+$/.test(input.profileName) || !input.model.trim()) {
    return { ok: false, reason: '模型目录参数无效' }
  }
  const file = path.join(home, '.codex', `${input.profileName}.models.json`)
  try {
    if (fs.existsSync(file) && !catalogOwnedBy(fs.readFileSync(file, 'utf8'), input.cloneId)) {
      return { ok: false, reason: `已存在非本应用文件：${file}` }
    }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const content = buildCodexModelCatalog(input.model, input.cloneId, readTemplateModel(home, input.model))
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, content, 'utf8')
    fs.renameSync(tmp, file)
    registerOwnedResource(
      { kind: 'codexCatalog', path: file, cloneId: input.cloneId, profileName: input.profileName },
      ownedResourcesPath(home),
    )
    return { ok: true, path: file }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

function hasRingCodeCloneProfile(codexDir: string): boolean {
  try {
    return fs.readdirSync(codexDir).some((name) => {
      if (!/^ringcode-.+\.config\.toml$/.test(name)) return false
      try {
        return fs.readFileSync(path.join(codexDir, name), 'utf8').includes('model_provider = "ringcode-clone"')
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

export function quarantineLegacyCodexModelCache(home = os.homedir()): CacheQuarantineResult {
  const marker = path.join(ringcodeHome(home), CACHE_MIGRATION_MARKER)
  if (fs.existsSync(marker)) return { ok: true, changed: false }
  const codexDir = path.join(home, '.codex')
  const cache = path.join(codexDir, 'models_cache.json')
  if (!hasRingCodeCloneProfile(codexDir) || !fs.existsSync(cache)) return { ok: true, changed: false }
  const backup = path.join(codexDir, CACHE_BACKUP_NAME)
  try {
    if (fs.existsSync(backup)) {
      fs.mkdirSync(path.dirname(marker), { recursive: true })
      fs.writeFileSync(marker, `${new Date().toISOString()}\n`, 'utf8')
      return { ok: true, changed: false }
    }
    fs.renameSync(cache, backup)
    fs.mkdirSync(path.dirname(marker), { recursive: true })
    fs.writeFileSync(marker, `${new Date().toISOString()}\n`, 'utf8')
    return { ok: true, changed: true, backupPath: backup }
  } catch (error) {
    return { ok: false, changed: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
