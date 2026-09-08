import { describe, expect, it } from 'vitest'
import { withoutRecentFile } from './recentFiles'
import type { RecentFile } from '@/types'

const recent = (workspaceId: string, segments: string[]): RecentFile => ({
  name: segments[segments.length - 1],
  segments,
  workspaceId,
  workspacePath: `C:\\${workspaceId}`,
  at: 1,
})

describe('withoutRecentFile', () => {
  it('只移除同一工作区和同一路径的最近记录', () => {
    const files = [
      recent('one', ['docs', 'README.md']),
      recent('two', ['docs', 'README.md']),
      recent('one', ['docs', 'other.md']),
    ]

    expect(withoutRecentFile(files, 'one', ['docs', 'README.md'])).toEqual([
      recent('two', ['docs', 'README.md']),
      recent('one', ['docs', 'other.md']),
    ])
  })
})
