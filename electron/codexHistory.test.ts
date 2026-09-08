import { describe, expect, it } from 'vitest'
import { parseCodexSessionIndex } from './codexHistory'

describe('parseCodexSessionIndex', () => {
  it('读取 thread_name，后写覆盖先写', () => {
    const names = parseCodexSessionIndex([
      '{"id":"01abc","thread_name":"旧标题"}',
      '{"id":"01abc","thread_name":"完成 G2 订单与到期提醒"}',
      '{"id":"01def","thread_name":"生成拔萝卜插画"}',
      'not-json',
      '{"id":"01ghi"}',
    ].join('\n'))
    expect(names.get('01abc')).toBe('完成 G2 订单与到期提醒')
    expect(names.get('01def')).toBe('生成拔萝卜插画')
    expect(names.has('01ghi')).toBe(false)
  })
})
