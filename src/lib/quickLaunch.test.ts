import { describe, expect, it } from 'vitest'
import { appendAgentPreference, fitPinnedCount, moreListAgents, moveAgentOrder, orderedAgents, visibleAgents } from './quickLaunch'
import type { AgentDef } from '@/types'

function agent(id: string): AgentDef {
  return { id, name: id, command: id, icon: '', accent: '', historyRoots: [] }
}

describe('quickLaunch', () => {
  const agents = ['a', 'b', 'c', 'd', 'e'].map(agent)

  it('hides by stable id and appends unknown ids', () => {
    expect(visibleAgents(agents, { hiddenAgentIds: ['c'], agentOrder: ['b', 'a'] }).map((item) => item.id)).toEqual([
      'b',
      'a',
      'd',
      'e',
    ])
  })

  it('caps named buttons at 4 and shrinks when width is tight', () => {
    expect(
      fitPinnedCount({
        visibleCount: 5,
        buttonWidths: [80, 80, 80, 80, 80],
        moreWidth: 72,
        availableWidth: 1000,
      }),
    ).toBe(4)
    expect(
      fitPinnedCount({
        visibleCount: 5,
        buttonWidths: [80, 80, 80, 80, 80],
        moreWidth: 72,
        availableWidth: 80 + 72,
      }),
    ).toBe(1)
    expect(
      fitPinnedCount({
        visibleCount: 3,
        buttonWidths: [80, 80, 80],
        moreWidth: 72,
        availableWidth: 240,
      }),
    ).toBe(3)
  })

  it('moves order without wrapping', () => {
    expect(moveAgentOrder(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(moveAgentOrder(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
  })

  it('keeps hidden agents in the ordered registry', () => {
    expect(orderedAgents(agents, { hiddenAgentIds: ['c'], agentOrder: ['b', 'a'] }).map((item) => item.id)).toEqual([
      'b',
      'a',
      'c',
      'd',
      'e',
    ])
  })

  it('still caps at 4 named buttons when 20 entries fit by width', () => {
    const widths = Array.from({ length: 20 }, () => 64)
    expect(
      fitPinnedCount({
        visibleCount: 20,
        buttonWidths: widths,
        moreWidth: 96,
        availableWidth: 10_000,
      }),
    ).toBe(4)
    expect(
      fitPinnedCount({
        visibleCount: 1,
        buttonWidths: [80],
        moreWidth: 72,
        availableWidth: 400,
      }),
    ).toBe(1)
    expect(
      fitPinnedCount({
        visibleCount: 4,
        buttonWidths: [80, 80, 80, 80],
        moreWidth: 72,
        availableWidth: 400,
      }),
    ).toBe(4)
  })

  it('allows hiding every agent', () => {
    expect(visibleAgents(agents, { hiddenAgentIds: agents.map((item) => item.id), agentOrder: [] })).toEqual([])
  })

  it('lists overflow when idle, and searches all visible agents', () => {
    const overflow = [agents[4]!]
    expect(moreListAgents(agents, overflow, 4, '').map((item) => item.id)).toEqual(['e'])
    expect(moreListAgents(agents, overflow, 0, '').map((item) => item.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(moreListAgents(agents, overflow, 4, 'A').map((item) => item.id)).toEqual(['a'])
    expect(moreListAgents(agents, overflow, 4, 'zzz')).toEqual([])
  })

  it('appends new agents visible at the end and does not inherit hidden', () => {
    const next = [...agents, agent('f')]
    expect(
      appendAgentPreference({ hiddenAgentIds: ['a', 'c'], agentOrder: ['b', 'a'] }, next, 'f'),
    ).toEqual({
      hiddenAgentIds: ['a', 'c'],
      agentOrder: ['b', 'a', 'c', 'd', 'e', 'f'],
    })
    expect(visibleAgents(next, appendAgentPreference({ hiddenAgentIds: ['a'] }, next, 'f')).map((item) => item.id)).toEqual([
      'b',
      'c',
      'd',
      'e',
      'f',
    ])
  })
})
