import { ipcMain } from 'electron'
import { getCredential } from './cred'
import { isAllowedExternalUrl } from './urlSafe'

export const CLAUDE_OFFICIAL_MODELS_URL = 'https://api.anthropic.com/v1/models'
export const CODEX_OFFICIAL_MODELS_URL = 'https://api.openai.com/v1/models'

const MAX_MODELS = 500
const MAX_BODY = 2 * 1024 * 1024
const TIMEOUT_MS = 15_000
const ANTHROPIC_VERSION = '2023-06-01'

export type CloneModelFamily = 'claude' | 'codex'

export interface ListCloneModelsInput {
  family?: unknown
  baseUrl?: unknown
  apiKey?: unknown
  credentialRef?: unknown
}

export type ListCloneModelsResult =
  | { ok: true; models: string[]; sourceUrl: string }
  | { ok: false; reason: string }

export interface CloneModelFetchDeps {
  fetch?: typeof fetch
  getCredential?: (ref: string) => string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function isCloneModelFamily(value: unknown): value is CloneModelFamily {
  return value === 'claude' || value === 'codex'
}

export function isVersionRootPath(path: string): boolean {
  return /\/v\d+$/i.test(path) || /\/api\/v\d+$/i.test(path) || /\/api\/paas\/v\d+$/i.test(path)
}

export function resolveModelListUrls(
  family: CloneModelFamily,
  baseUrl: string,
): { ok: true; urls: string[] } | { ok: false; reason: string } {
  const raw = baseUrl.trim()
  if (!raw) {
    return { ok: true, urls: [family === 'claude' ? CLAUDE_OFFICIAL_MODELS_URL : CODEX_OFFICIAL_MODELS_URL] }
  }
  if (!isAllowedExternalUrl(raw)) return { ok: false, reason: 'API URL 无效，仅支持 http(s)' }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, reason: 'API URL 无效，仅支持 http(s)' }
  }
  const base = raw.replace(/\/+$/, '')
  const path = parsed.pathname.replace(/\/+$/, '')
  const urls: string[] = []
  const push = (url: string) => {
    if (!urls.includes(url)) urls.push(url)
  }
  if (/\/models$/i.test(base)) push(base)
  else if (isVersionRootPath(path) || /\/v\d+$/i.test(base)) push(`${base}/models`)
  else {
    push(`${base}/v1/models`)
    push(`${base}/models`)
  }
  if (path && path !== '/' && !isVersionRootPath(path) && !/\/models$/i.test(path)) {
    push(`${parsed.origin}/v1/models`)
    push(`${parsed.origin}/models`)
  }
  return { ok: true, urls }
}

export function modelListHeaders(family: CloneModelFamily, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'api-key': apiKey,
  }
  if (family === 'claude') {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = ANTHROPIC_VERSION
  }
  return headers
}

export function parseModelIds(payload: unknown): string[] {
  const rec = asRecord(payload)
  const buckets: unknown[] = []
  if (Array.isArray(payload)) buckets.push(...payload)
  if (rec) {
    if (Array.isArray(rec.data)) buckets.push(...rec.data)
    if (Array.isArray(rec.models)) buckets.push(...rec.models)
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of buckets) {
    let id = ''
    if (typeof item === 'string') id = item.trim()
    else if (item && typeof item === 'object') {
      const row = item as Record<string, unknown>
      if (typeof row.id === 'string') id = row.id.trim()
      else if (typeof row.name === 'string') id = row.name.trim()
    }
    if (!id || id.length > 200 || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= MAX_MODELS) break
  }
  return out
}

export function parseProviderError(payload: unknown): string | null {
  const rec = asRecord(payload)
  if (!rec) return null
  if (typeof rec.message === 'string' && rec.message.trim()) return rec.message.trim()
  const err = rec.error
  if (typeof err === 'string' && err.trim()) return err.trim()
  const nested = asRecord(err)
  if (nested && typeof nested.message === 'string' && nested.message.trim()) return nested.message.trim()
  return null
}

export function redactModelListError(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/(api[_-]?key|token|secret|authorization)\s*[:=]\s*.+/gi, '$1=***')
    .slice(0, 180)
}

function resolveApiKey(
  input: ListCloneModelsInput,
  readCred: (ref: string) => string | null,
): { ok: true; key: string } | { ok: false; reason: string } {
  const typed = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
  if (typed) return { ok: true, key: typed }
  const ref = typeof input.credentialRef === 'string' ? input.credentialRef.trim() : ''
  if (!ref) return { ok: false, reason: '请先填写 API Key' }
  if (!ref.startsWith('ringcode:')) return { ok: false, reason: '无效的凭据引用' }
  const stored = readCred(ref)?.trim() ?? ''
  if (!stored) return { ok: false, reason: '请先填写 API Key' }
  return { ok: true, key: stored }
}

interface FetchAttempt {
  ok: boolean
  models?: string[]
  sourceUrl?: string
  reason?: string
  retry?: boolean
}

async function fetchModelsFromUrl(
  url: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch,
): Promise<FetchAttempt> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetchFn(url, { method: 'GET', headers, signal: ctrl.signal })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return { ok: false, reason: '获取超时', retry: true }
    return { ok: false, reason: '网络请求失败', retry: true }
  } finally {
    clearTimeout(timer)
  }

  const length = Number(res.headers.get('content-length') ?? 0)
  if (Number.isFinite(length) && length > MAX_BODY) return { ok: false, reason: '模型列表过大', retry: true }
  const text = await res.text()
  if (text.length > MAX_BODY) return { ok: false, reason: '模型列表过大', retry: true }

  let payload: unknown = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'Key 无效或无权访问', retry: false }
    return { ok: false, reason: res.ok ? '响应不是模型列表' : `网关返回 ${res.status}`, retry: res.status === 404 || res.status === 405 }
  }

  const providerErr = parseProviderError(payload)
  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: redactModelListError(providerErr || 'Key 无效或无权访问'), retry: false }
  }
  if (!res.ok) {
    return {
      ok: false,
      reason: redactModelListError(providerErr || `网关返回 ${res.status}`),
      retry: res.status === 404 || res.status === 405,
    }
  }
  const models = parseModelIds(payload)
  if (!models.length) {
    return { ok: false, reason: redactModelListError(providerErr || '接口返回了空列表'), retry: true }
  }
  return { ok: true, models, sourceUrl: url }
}

export async function listCloneModels(
  input: ListCloneModelsInput,
  deps: CloneModelFetchDeps = {},
): Promise<ListCloneModelsResult> {
  if (!isCloneModelFamily(input.family)) return { ok: false, reason: '只能为 Claude 或 Codex 分身获取模型' }
  const key = resolveApiKey(input, deps.getCredential ?? getCredential)
  if (!key.ok) return key
  const urls = resolveModelListUrls(input.family, typeof input.baseUrl === 'string' ? input.baseUrl : '')
  if (!urls.ok) return urls
  const headers = modelListHeaders(input.family, key.key)
  const fetchFn = deps.fetch ?? fetch
  let lastReason = '未获取到模型列表'
  for (const url of urls.urls) {
    const attempt = await fetchModelsFromUrl(url, headers, fetchFn)
    if (attempt.ok && attempt.models && attempt.sourceUrl) {
      return { ok: true, models: attempt.models, sourceUrl: attempt.sourceUrl }
    }
    lastReason = attempt.reason || lastReason
    if (attempt.retry === false) break
  }
  return { ok: false, reason: lastReason }
}

export function registerCloneModelHandlers(): void {
  ipcMain.handle('clone:listModels', (_e, input: ListCloneModelsInput) => listCloneModels(input))
}
