import { describe, expect, it } from 'vitest'
import { applyAutoSessionTitle } from './sessionTitle'

describe('applyAutoSessionTitle', () => {
  it('用 Agent 原生总结标题替换自动标题', () => {
    expect(applyAutoSessionTitle(
      { autoTitled: true, title: 'Claude 会话' },
      '打包免安装exe',
    )).toEqual({ title: '打包免安装exe', nativeTitled: true })
  })

  it('用户手动改名后不再覆盖', () => {
    expect(applyAutoSessionTitle(
      { autoTitled: false, title: '我起的名字' },
      '打包免安装exe',
    )).toBeNull()
  })

  it('拒绝噪声原生标题，保留当前值', () => {
    expect(applyAutoSessionTitle(
      { autoTitled: true, title: 'Claude 会话' },
      'Waiting for API response · will retry in…',
    )).toBeNull()
  })

  it('旧快照没有 autoTitled 字段时仍可写入原生标题', () => {
    expect(applyAutoSessionTitle(
      { title: '帮我看一下这个乱码标题 ░░' },
      '修复历史列表标题',
    )?.title).toBe('修复历史列表标题')
  })
})
