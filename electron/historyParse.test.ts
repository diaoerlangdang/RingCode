import { describe, expect, it } from 'vitest'
import { applyCliTitle, contentHasToolResult, shouldSkipHistoryBodyEvent } from './historyParse'

describe('historyParse', () => {
  it('Claude ai-title 覆盖先前的 summary', () => {
    let title = applyCliTitle('', { type: 'summary', summary: '旧摘要' })
    title = applyCliTitle(title, { type: 'ai-title', aiTitle: '打包免安装exe' })
    expect(title).toBe('打包免安装exe')
  })

  it('没有 ai-title 时保留 summary，后续空 summary 不覆盖', () => {
    let title = applyCliTitle('', { type: 'summary', summary: '修复登录' })
    title = applyCliTitle(title, { type: 'summary', summary: '' })
    expect(title).toBe('修复登录')
  })

  it('跳过 attachment / last-prompt / 子 agent', () => {
    expect(shouldSkipHistoryBodyEvent({ type: 'attachment' })).toBe(true)
    expect(shouldSkipHistoryBodyEvent({ type: 'last-prompt' })).toBe(true)
    expect(shouldSkipHistoryBodyEvent({ type: 'ai-title' })).toBe(true)
    expect(shouldSkipHistoryBodyEvent({ isSidechain: true, type: 'user' })).toBe(true)
    expect(shouldSkipHistoryBodyEvent({ type: 'user' })).toBe(false)
  })

  it('识别 tool_result，避免把工具输出当作用户标题', () => {
    expect(contentHasToolResult([{ type: 'tool_result', content: 'node_modules' }])).toBe(true)
    expect(contentHasToolResult('帮我打包')).toBe(false)
  })
})
