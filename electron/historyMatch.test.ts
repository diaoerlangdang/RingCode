import { describe, expect, it } from 'vitest'
import { matchesRecentNativeSession, sameHistoryPath } from './historyMatch'

describe('native session history matching', () => {
  it('Windows 路径匹配忽略大小写和末尾分隔符', () => {
    expect(sameHistoryPath('C:\\Work\\Demo\\', 'c:\\work\\demo', 'win32')).toBe(true)
  })

  it('必须同时满足工作目录和启动时间窗口', () => {
    const lookup = { projectPath: 'C:\\work\\demo', startedAt: 10_000 }
    expect(matchesRecentNativeSession({ projectPath: 'C:\\work\\demo', nativeSessionId: 'new', startedAt: 10_500, mtime: 10_500 }, lookup, 'win32')).toBe(true)
    expect(matchesRecentNativeSession({ projectPath: 'C:\\other', nativeSessionId: 'new', startedAt: 10_500, mtime: 10_500 }, lookup, 'win32')).toBe(false)
    expect(matchesRecentNativeSession({ projectPath: 'C:\\work\\demo', nativeSessionId: 'old', startedAt: 4_000, mtime: 10_500 }, lookup, 'win32')).toBe(false)
  })

  it('创建分支时排除来源 session id', () => {
    expect(
      matchesRecentNativeSession(
        { projectPath: 'C:\\work', nativeSessionId: 'source', startedAt: 19_500, mtime: 20_000 },
        { projectPath: 'C:\\work', startedAt: 19_000, excludeSessionId: 'source' },
        'win32',
      ),
    ).toBe(false)
  })
})
