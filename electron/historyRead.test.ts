import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readHistoryPage } from './historyRead'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempHistory(content: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ringcode-history-'))
  dirs.push(dir)
  const file = path.join(dir, 'session.jsonl')
  await writeFile(file, content, 'utf8')
  return file
}

describe('readHistoryPage', () => {
  it('小文件一次完整读取', async () => {
    const raw = JSON.stringify({ role: 'user', content: '完整正文' })
    const file = await tempHistory(raw)

    expect(await readHistoryPage(file, undefined, 1024)).toEqual({
      content: raw,
      start: 0,
      end: Buffer.byteLength(raw),
      hasMore: false,
    })
  })

  it('从文件末尾按完整 JSONL 行分页并可一直读到开头', async () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      JSON.stringify({ role: index % 2 ? 'assistant' : 'user', content: `消息-${index}-${'x'.repeat(35)}` }),
    )
    const raw = rows.join('\n')
    const file = await tempHistory(raw)
    const pages: string[] = []
    let before: number | undefined

    do {
      const page = await readHistoryPage(file, before, 140)
      pages.unshift(page.content)
      before = page.hasMore ? page.start : undefined
      if (!page.hasMore) break
    } while (true)

    expect(pages.join('')).toBe(raw)
  })

  it('单条消息超过分页大小时仍返回完整行', async () => {
    const huge = JSON.stringify({ role: 'assistant', content: 'x'.repeat(500) })
    const latest = JSON.stringify({ role: 'user', content: '最近消息' })
    const raw = `${huge}\n${latest}`
    const file = await tempHistory(raw)

    const latestPage = await readHistoryPage(file, undefined, 80)
    const earlierPage = await readHistoryPage(file, latestPage.start, 80)

    expect(latestPage.content).toBe(latest)
    expect(earlierPage.content).toBe(`${huge}\n`)
    expect(earlierPage.hasMore).toBe(false)
  })
})
