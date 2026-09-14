import { describe, expect, it, vi } from 'vitest'
import {
  CLAUDE_OFFICIAL_MODELS_URL,
  CODEX_OFFICIAL_MODELS_URL,
  listCloneModels,
  modelListHeaders,
  parseModelIds,
  parseProviderError,
  redactModelListError,
  resolveModelListUrls,
} from './cloneModels'

function jsonResponse(status: number, body: unknown, url = 'https://gw.example/v1/models'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
    url,
  })
}

describe('resolveModelListUrls', () => {
  it('空 URL 走官方列表', () => {
    expect(resolveModelListUrls('claude', '')).toEqual({ ok: true, urls: [CLAUDE_OFFICIAL_MODELS_URL] })
    expect(resolveModelListUrls('codex', '  ')).toEqual({ ok: true, urls: [CODEX_OFFICIAL_MODELS_URL] })
  })

  it('自定义根路径先试自身 /v1/models，再回退主机 /v1/models', () => {
    expect(resolveModelListUrls('claude', 'https://api.xiaomimimo.com/anthropic')).toEqual({
      ok: true,
      urls: [
        'https://api.xiaomimimo.com/anthropic/v1/models',
        'https://api.xiaomimimo.com/anthropic/models',
        'https://api.xiaomimimo.com/v1/models',
        'https://api.xiaomimimo.com/models',
      ],
    })
  })

  it('已带 /v1 或 /models 时不再重复拼接', () => {
    expect(resolveModelListUrls('codex', 'https://api.openai.com/v1/')).toEqual({
      ok: true,
      urls: ['https://api.openai.com/v1/models'],
    })
    expect(resolveModelListUrls('codex', 'https://gw.example/v1/models')).toEqual({
      ok: true,
      urls: ['https://gw.example/v1/models'],
    })
  })

  it('硅基流动 /v1、方舟 /api/v3 只补 /models', () => {
    expect(resolveModelListUrls('codex', 'https://api.siliconflow.cn/v1')).toEqual({
      ok: true,
      urls: ['https://api.siliconflow.cn/v1/models'],
    })
    expect(resolveModelListUrls('codex', 'https://ark.cn-beijing.volces.com/api/v3')).toEqual({
      ok: true,
      urls: ['https://ark.cn-beijing.volces.com/api/v3/models'],
    })
  })

  it('拒绝非 http(s)', () => {
    expect(resolveModelListUrls('claude', 'file:///C:/Windows/models')).toEqual({
      ok: false,
      reason: 'API URL 无效，仅支持 http(s)',
    })
  })
})

describe('parseModelIds / errors', () => {
  it('读取 data.id，去重且保持顺序', () => {
    expect(
      parseModelIds({
        data: [{ id: 'mimo-v2.5-pro' }, { id: 'mimo-v2.5-pro' }, { name: 'only-name' }, { id: '' }],
      }),
    ).toEqual(['mimo-v2.5-pro', 'only-name'])
  })

  it('兼容 models 数组和纯字符串列表', () => {
    expect(parseModelIds({ models: ['a', { id: 'b' }] })).toEqual(['a', 'b'])
    expect(parseModelIds(['x', { name: 'y' }])).toEqual(['x', 'y'])
  })

  it('解析网关错误并脱敏', () => {
    expect(parseProviderError({ error: { message: 'bad key sk-abcdefghijk' } })).toBe('bad key sk-abcdefghijk')
    expect(redactModelListError('bad key sk-abcdefghijk authorization=Bearer secret')).toContain('sk-***')
    expect(redactModelListError('authorization=Bearer secret')).not.toContain('secret')
  })
})

describe('modelListHeaders', () => {
  it('Claude 同时带 x-api-key 与 Bearer', () => {
    expect(modelListHeaders('claude', 'k')).toMatchObject({
      Authorization: 'Bearer k',
      'x-api-key': 'k',
      'api-key': 'k',
      'anthropic-version': '2023-06-01',
    })
    expect(modelListHeaders('codex', 'k')).toMatchObject({
      Authorization: 'Bearer k',
      'api-key': 'k',
    })
    expect(modelListHeaders('codex', 'k')['x-api-key']).toBeUndefined()
  })
})

describe('listCloneModels', () => {
  it('缺 Key 时不发请求', async () => {
    const fetchFn = vi.fn()
    await expect(listCloneModels({ family: 'claude', baseUrl: '' }, { fetch: fetchFn })).resolves.toEqual({
      ok: false,
      reason: '请先填写 API Key',
    })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('拒绝非 ringcode 凭据引用', async () => {
    const read = vi.fn()
    await expect(
      listCloneModels({ family: 'codex', credentialRef: 'windows:other' }, { fetch: vi.fn(), getCredential: read }),
    ).resolves.toEqual({ ok: false, reason: '无效的凭据引用' })
    expect(read).not.toHaveBeenCalled()
  })

  it('404 后改试 /models，并可用凭据库 Key', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).endsWith('/v1/models')) return jsonResponse(404, { error: { message: 'missing' } }, String(url))
      return jsonResponse(200, { data: [{ id: 'gpt-x' }, { id: 'gpt-y' }] }, String(url))
    })
    const result = await listCloneModels(
      { family: 'codex', baseUrl: 'https://gw.example', credentialRef: 'ringcode:clone:c1' },
      { fetch: fetchFn as unknown as typeof fetch, getCredential: () => 'stored-key' },
    )
    expect(result).toEqual({
      ok: true,
      models: ['gpt-x', 'gpt-y'],
      sourceUrl: 'https://gw.example/models',
    })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('401 不再试下一个地址', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(401, { error: { message: 'unauthorized' } }))
    await expect(
      listCloneModels(
        { family: 'claude', baseUrl: 'https://gw.example', apiKey: 'bad' },
        { fetch: fetchFn as unknown as typeof fetch },
      ),
    ).resolves.toEqual({ ok: false, reason: 'unauthorized' })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})
