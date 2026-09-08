import { describe, expect, it } from 'vitest'
import {
  defaultExpandedHistoryGroups,
  groupHistoryItems,
  normalizeHistoryPath,
  pageHistoryItems,
  resolveHistoryExpansion,
  setVisibleHistoryExpansion,
  sortHistoryGroupsForWorkspace,
} from './historyGrouping'

interface Item {
  id: string
  directory: string
  updatedAt: number
  tool: string
  title: string
  text: string
  favorite?: boolean
}

const item = (patch: Partial<Item> & Pick<Item, 'id' | 'directory' | 'updatedAt'>): Item => ({
  tool: 'claude',
  title: patch.id,
  text: '',
  ...patch,
})

const options = {
  getId: (value: Item) => value.id,
  getDirectory: (value: Item) => value.directory,
  getUpdatedAt: (value: Item) => value.updatedAt,
  getTool: (value: Item) => value.tool,
  getSearchText: (value: Item) => `${value.title}\n${value.text}`,
}

describe('normalizeHistoryPath', () => {
  it('Windows 路径忽略大小写、斜杠方向和末尾斜杠', () => {
    expect(normalizeHistoryPath('E:\\Work\\RingCode\\')).toBe('e:/work/ringcode')
    expect(normalizeHistoryPath('e:/WORK/RingCode')).toBe('e:/work/ringcode')
  })

  it('空路径使用稳定的未知目录键', () => {
    expect(normalizeHistoryPath('')).toBe('__unknown__')
    expect(normalizeHistoryPath('   ')).toBe('__unknown__')
  })
})

describe('groupHistoryItems', () => {
  it('同一完整目录归组，同名不同路径不合并，组内严格按更新时间倒序', () => {
    const groups = groupHistoryItems(
      [
        item({ id: 'old-favorite', directory: 'E:\\work\\RingCode', updatedAt: 10, favorite: true }),
        item({ id: 'new', directory: 'e:/WORK/RingCode/', updatedAt: 30 }),
        item({ id: 'other-same-name', directory: 'D:\\archive\\RingCode', updatedAt: 20 }),
      ],
      { ...options },
    )

    expect(groups).toHaveLength(2)
    expect(groups[0].items.map((value) => value.id)).toEqual(['new', 'old-favorite'])
    expect(groups[1].items.map((value) => value.id)).toEqual(['other-same-name'])
  })

  it('当前工作区根目录置顶、子目录紧随、其他目录按最近时间排序、未知目录最后', () => {
    const groups = groupHistoryItems(
      [
        item({ id: 'other-newest', directory: 'D:\\other', updatedAt: 100 }),
        item({ id: 'child-old', directory: 'E:\\work\\RingCode\\frontend', updatedAt: 20 }),
        item({ id: 'root', directory: 'E:\\work\\RingCode', updatedAt: 10 }),
        item({ id: 'child-new', directory: 'E:\\work\\RingCode\\backend', updatedAt: 30 }),
        item({ id: 'unknown', directory: '', updatedAt: 1000 }),
      ],
      { ...options, activeWorkspacePath: 'e:/work/ringcode/' },
    )

    expect(groups.map((group) => group.items[0].id)).toEqual([
      'root',
      'child-new',
      'child-old',
      'other-newest',
      'unknown',
    ])
    expect(groups.map((group) => group.relation)).toEqual(['root', 'child', 'child', 'other', 'unknown'])
  })

  it('相似前缀不是当前工作区子目录', () => {
    const groups = groupHistoryItems(
      [
        item({ id: 'real-child', directory: 'E:\\work\\app\\src', updatedAt: 10 }),
        item({ id: 'prefix-only', directory: 'E:\\work\\app-old', updatedAt: 20 }),
      ],
      { ...options, activeWorkspacePath: 'E:\\work\\app' },
    )

    expect(groups.find((group) => group.items[0].id === 'real-child')?.relation).toBe('child')
    expect(groups.find((group) => group.items[0].id === 'prefix-only')?.relation).toBe('other')
  })

  it('可将主进程返回的目录摘要按当前工作区重新排序', () => {
    const summaries = [
      { path: 'D:\\newest', latest: 100, unknown: false },
      { path: 'E:\\work\\RingCode\\frontend', latest: 20, unknown: false },
      { path: 'E:\\work\\RingCode', latest: 10, unknown: false },
      { path: '', latest: 1000, unknown: true },
    ]
    expect(
      sortHistoryGroupsForWorkspace(
        summaries,
        'E:\\work\\RingCode',
        (group) => group.path,
        (group) => group.latest,
        (group) => group.unknown,
      ).map((group) => group.path),
    ).toEqual(['E:\\work\\RingCode', 'E:\\work\\RingCode\\frontend', 'D:\\newest', ''])
  })

  it('路径命中时显示目录内所有符合 Agent 筛选的会话', () => {
    const groups = groupHistoryItems(
      [
        item({ id: 'claude-a', directory: 'E:\\work\\RingCode', updatedAt: 30, tool: 'claude', title: '无关标题' }),
        item({ id: 'codex-a', directory: 'E:\\work\\RingCode', updatedAt: 20, tool: 'codex', title: '无关标题' }),
        item({ id: 'other', directory: 'E:\\work\\Other', updatedAt: 10, title: 'RingCode 正文命中' }),
      ],
      { ...options, query: 'ringcode', tool: 'claude' },
    )

    expect(groups.map((group) => [group.name, group.items.map((value) => value.id)])).toEqual([
      ['RingCode', ['claude-a']],
      ['Other', ['other']],
    ])
    expect(groups[0].totalCount).toBe(2)
    expect(groups[0].matchedCount).toBe(1)
  })

  it('正文搜索只保留命中会话，并隐藏空目录组', () => {
    const groups = groupHistoryItems(
      [
        item({ id: 'hit', directory: 'E:\\work\\A', updatedAt: 20, text: '修复登录问题' }),
        item({ id: 'miss-same-dir', directory: 'E:\\work\\A', updatedAt: 10, text: '其他内容' }),
        item({ id: 'miss-other-dir', directory: 'E:\\work\\B', updatedAt: 30, text: '其他内容' }),
      ],
      { ...options, query: '登录' },
    )

    expect(groups).toHaveLength(1)
    expect(groups[0].items.map((value) => value.id)).toEqual(['hit'])
    expect(groups[0].matchedCount).toBe(1)
    expect(groups[0].totalCount).toBe(2)
  })
})

describe('目录默认展开与分页', () => {
  it('优先展开当前工作区根目录，否则展开最近的正常目录，不展开未知目录', () => {
    const groups = groupHistoryItems(
      [
        item({ id: 'recent', directory: 'D:\\recent', updatedAt: 30 }),
        item({ id: 'root', directory: 'E:\\work\\RingCode', updatedAt: 10 }),
        item({ id: 'unknown', directory: '', updatedAt: 100 }),
      ],
      { ...options, activeWorkspacePath: 'E:\\work\\RingCode' },
    )
    expect(defaultExpandedHistoryGroups(groups, 'E:\\work\\RingCode')).toEqual([
      normalizeHistoryPath('E:\\work\\RingCode'),
    ])

    const withoutRoot = groups.filter((group) => group.relation !== 'root')
    expect(defaultExpandedHistoryGroups(withoutRoot, 'E:\\missing')).toEqual([
      normalizeHistoryPath('D:\\recent'),
    ])
  })

  it('每组默认 30 条且每次增加 30 条', () => {
    const values = Array.from({ length: 75 }, (_, index) => index)
    expect(pageHistoryItems(values, 30)).toHaveLength(30)
    expect(pageHistoryItems(values, 60)).toHaveLength(60)
    expect(pageHistoryItems(values, 90)).toHaveLength(75)
  })

  it('保存过的展开状态优先，新目录才应用默认规则', () => {
    const groups = groupHistoryItems(
      [
        item({ id: 'root', directory: 'E:\\work\\RingCode', updatedAt: 20 }),
        item({ id: 'other', directory: 'D:\\other', updatedAt: 10 }),
      ],
      { ...options, activeWorkspacePath: 'E:\\work\\RingCode' },
    )
    const rootKey = normalizeHistoryPath('E:\\work\\RingCode')
    const otherKey = normalizeHistoryPath('D:\\other')

    expect(resolveHistoryExpansion(groups, { [rootKey]: false }, 'E:\\work\\RingCode')).toEqual({
      [rootKey]: false,
      [otherKey]: false,
    })
    expect(resolveHistoryExpansion(groups, {}, 'E:\\work\\RingCode')).toEqual({
      [rootKey]: true,
      [otherKey]: false,
    })
  })

  it('全部展开或折叠只修改当前可见目录', () => {
    expect(setVisibleHistoryExpansion({ a: true, b: false, hidden: true }, ['a', 'b'], false)).toEqual({
      a: false,
      b: false,
      hidden: true,
    })
  })
})
