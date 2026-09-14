import { describe, expect, it } from 'vitest'
import {
  beginLaunchAttempt,
  isLatestLaunchAttempt,
  markLaunchAttemptCommitted,
  revertLaunchAttemptIfLatest,
} from './launchAttempts'

describe('启动 attempt', () => {
  it('仅最新已提交的失败尝试可撤回上次入口', () => {
    const first = beginLaunchAttempt('s1', 'clone-a', 'codex')
    const second = beginLaunchAttempt('s1', 'clone-b', 'clone-a')
    markLaunchAttemptCommitted(first)
    expect(revertLaunchAttemptIfLatest('s1', first)).toBeUndefined()
    expect(isLatestLaunchAttempt('s1', second)).toBe(true)
    expect(revertLaunchAttemptIfLatest('s1', second)).toBeUndefined()
    markLaunchAttemptCommitted(second)
    expect(revertLaunchAttemptIfLatest('s1', second)).toEqual({ previous: 'clone-a', entryId: 'clone-b' })
  })

  it('未提交的 spawn 失败不撤回', () => {
    const attempt = beginLaunchAttempt('s2', 'clone-a', 'codex')
    expect(revertLaunchAttemptIfLatest('s2', attempt)).toBeUndefined()
  })
})
