import { describe, expect, it } from 'vitest'
import { compactHistoryTitle, isUsableHistoryTitle, selectHistoryTitle } from './historyTitle'

describe('selectHistoryTitle', () => {
  it('CLI 原生标题优先于第一条用户消息和正文兜底', () => {
    expect(selectHistoryTitle('修复 Markdown 图片预览', '帮我看一下图片', '正文第一行')).toBe('修复 Markdown 图片预览')
  })

  it('没有 CLI 标题时使用第一条用户消息', () => {
    expect(selectHistoryTitle('', '帮我看一下图片', '正文第一行')).toBe('帮我看一下图片')
  })

  it('CLI 标题和用户消息都没有时使用正文兜底', () => {
    expect(selectHistoryTitle('  ', '', '正文第一行')).toBe('正文第一行')
  })

  it('拒绝 hook / 超长倾倒，回退到可用标题', () => {
    const dump = '<EXTREMELY_IMPORTANT>\nYou have superpowers.\n{"hookSpecificOutput":true}'
    expect(isUsableHistoryTitle(dump)).toBe(false)
    expect(selectHistoryTitle(dump, '打包免安装exe', '正文')).toBe('打包免安装exe')
  })

  it('压缩过长用户消息为单行短标题', () => {
    expect(compactHistoryTitle('第一行\n第二行')).toBe('第一行')
    expect(selectHistoryTitle('', `${'很长的用户请求内容'.repeat(20)}`, '')).toMatch(/…$/)
  })
})
