import { describe, expect, it } from 'vitest'
import { runningAiTerminals } from './runningAi'
import type { TerminalTab } from '@/types'

function tab(partial: Partial<TerminalTab> & Pick<TerminalTab, 'id' | 'kind'>): TerminalTab {
  return {
    title: partial.id,
    createdAt: 1,
    ...partial,
  }
}

describe('runningAiTerminals', () => {
  it('blocks cleanup against live AI tabs and ignores orphaned/shell tabs', () => {
    const terminals: TerminalTab[] = [
      tab({ id: 'ai-a', kind: 'ai', tool: 'clone-a', sessionId: 's1' }),
      tab({ id: 'ai-b', kind: 'ai', tool: 'clone-b', sessionId: 's2' }),
      tab({ id: 'dead', kind: 'ai', tool: 'clone-a', orphaned: true }),
      tab({ id: 'sh', kind: 'shell' }),
    ]
    expect(runningAiTerminals(terminals).map((item) => item.id)).toEqual(['ai-a', 'ai-b'])
    expect(runningAiTerminals(terminals, 'clone-a').map((item) => item.id)).toEqual(['ai-a'])
    expect(runningAiTerminals(terminals, 'clone-missing')).toEqual([])
  })
})
