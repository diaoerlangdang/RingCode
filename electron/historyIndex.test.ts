import { describe, expect, it } from 'vitest'
import { buildDiskHistoryGroups, listDiskHistoryGroup, normalizeDiskHistoryPath, type DiskHistoryRecord } from './historyIndex'

const record = (index: number, projectPath: string, tool = 'claude', text = ''): DiskHistoryRecord => ({
  tool,
  projectPath,
  sessionFile: `session-${index}.jsonl`,
  sessionId: `session-${index}`,
  title: `会话 ${index}`,
  snippet: text,
  searchText: `${text}\n会话 ${index}`,
  startedAt: index,
  mtime: index,
})

describe('磁盘历史目录索引', () => {
  it('索引全部记录，不受旧的全局 50 条限制', () => {
    const records = Array.from({ length: 75 }, (_, index) => record(index, 'E:\\work\\RingCode'))
    const groups = buildDiskHistoryGroups(records, { query: '', tool: 'all' }, new Map([
      [normalizeDiskHistoryPath('E:\\work\\RingCode'), true],
    ]))

    expect(groups).toHaveLength(1)
    expect(groups[0].totalCount).toBe(75)
    expect(groups[0].matchedCount).toBe(75)
    expect(groups[0].latestMtime).toBe(74)
    expect(groups[0].available).toBe(true)
  })

  it('目录路径命中时保留该目录下符合 Agent 筛选的全部记录', () => {
    const records = [
      record(3, 'E:\\work\\RingCode', 'claude'),
      record(2, 'E:\\work\\RingCode', 'codex'),
      record(1, 'E:\\work\\Other', 'claude', 'ringcode 正文'),
    ]
    const groups = buildDiskHistoryGroups(records, { query: 'ringcode', tool: 'claude' })

    expect(groups.map((group) => [group.name, group.matchedCount, group.totalCount])).toEqual([
      ['RingCode', 1, 2],
      ['Other', 1, 1],
    ])
  })

  it('无路径记录归入未知目录并固定排在最后', () => {
    const groups = buildDiskHistoryGroups([
      record(1, '', 'claude'),
      record(2, 'D:\\known', 'claude'),
    ], { query: '', tool: 'all' })

    expect(groups.map((group) => group.name)).toEqual(['known', '未知目录'])
    expect(groups[1].unknown).toBe(true)
    expect(groups[1].available).toBe(false)
  })
})

describe('磁盘目录会话分页', () => {
  it('按 mtime 倒序并返回准确总数和批次', () => {
    const records = Array.from({ length: 75 }, (_, index) => record(index, 'E:\\work\\RingCode'))
    const first = listDiskHistoryGroup(records, {
      directoryKey: normalizeDiskHistoryPath('E:\\work\\RingCode'),
      query: '',
      tool: 'all',
      offset: 0,
      limit: 30,
    })
    const third = listDiskHistoryGroup(records, {
      directoryKey: normalizeDiskHistoryPath('E:\\work\\RingCode'),
      query: '',
      tool: 'all',
      offset: 60,
      limit: 30,
    })

    expect(first.total).toBe(75)
    expect(first.items).toHaveLength(30)
    expect(first.items[0].mtime).toBe(74)
    expect(first.items[29].mtime).toBe(45)
    expect(third.items).toHaveLength(15)
    expect(third.items[0].mtime).toBe(14)
  })

  it('正文查询只分页返回匹配记录', () => {
    const records = [
      record(3, 'E:\\work\\RingCode', 'claude', '登录修复'),
      record(2, 'E:\\work\\RingCode', 'claude', '无关'),
      record(1, 'E:\\work\\RingCode', 'codex', '登录修复'),
    ]
    const result = listDiskHistoryGroup(records, {
      directoryKey: normalizeDiskHistoryPath('E:\\work\\RingCode'),
      query: '登录',
      tool: 'claude',
      offset: 0,
      limit: 30,
    })

    expect(result.total).toBe(1)
    expect(result.items.map((item) => item.sessionId)).toEqual(['session-3'])
  })
})
