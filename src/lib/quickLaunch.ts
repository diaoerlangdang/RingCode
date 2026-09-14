import type { AgentDef, QuickLaunchPrefs } from '@/types'

export const QUICK_LAUNCH_MAX_PINNED = 4

export function normalizeQuickLaunch(
  agents: AgentDef[],
  prefs?: QuickLaunchPrefs,
): { hidden: Set<string>; order: string[] } {
  const ids = agents.map((agent) => agent.id)
  const idSet = new Set(ids)
  const hidden = new Set((prefs?.hiddenAgentIds ?? []).filter((id) => idSet.has(id)))
  const seen = new Set<string>()
  const order: string[] = []
  for (const id of prefs?.agentOrder ?? []) {
    if (!idSet.has(id) || seen.has(id)) continue
    seen.add(id)
    order.push(id)
  }
  for (const id of ids) {
    if (seen.has(id)) continue
    order.push(id)
  }
  return { hidden, order }
}

export function orderedAgents(agents: AgentDef[], prefs?: QuickLaunchPrefs): AgentDef[] {
  const map = new Map(agents.map((agent) => [agent.id, agent]))
  return normalizeQuickLaunch(agents, prefs).order.map((id) => map.get(id)!).filter(Boolean)
}

export function visibleAgents(agents: AgentDef[], prefs?: QuickLaunchPrefs): AgentDef[] {
  const { hidden } = normalizeQuickLaunch(agents, prefs)
  return orderedAgents(agents, prefs).filter((agent) => !hidden.has(agent.id))
}

export function fitPinnedCount(input: {
  visibleCount: number
  buttonWidths: number[]
  moreWidth: number
  availableWidth: number
  maxPinned?: number
}): number {
  const maxPinned = input.maxPinned ?? QUICK_LAUNCH_MAX_PINNED
  const n = input.visibleCount
  if (n <= 0 || input.availableWidth <= 0) return 0
  const limit = Math.min(maxPinned, n)
  for (let pinned = limit; pinned >= 0; pinned -= 1) {
    const overflow = n - pinned
    const needMore = overflow > 0 || (pinned === 0 && n > 0)
    const buttons = input.buttonWidths.slice(0, pinned).reduce((sum, width) => sum + width, 0)
    const width = buttons + (needMore ? input.moreWidth : 0)
    if (width <= input.availableWidth) return pinned
  }
  return 0
}

export function moveAgentOrder(order: string[], id: string, direction: -1 | 1): string[] {
  const index = order.indexOf(id)
  if (index < 0) return order
  const next = index + direction
  if (next < 0 || next >= order.length) return order
  const copy = [...order]
  ;[copy[index], copy[next]] = [copy[next]!, copy[index]!]
  return copy
}

/** 新建/导入入口默认显示，追加到现有顺序末尾，不继承隐藏。 */
export function appendAgentPreference(
  prefs: QuickLaunchPrefs | undefined,
  agents: AgentDef[],
  newId: string,
): QuickLaunchPrefs {
  const { hidden, order } = normalizeQuickLaunch(agents, prefs)
  hidden.delete(newId)
  const nextOrder = order.filter((id) => id !== newId)
  if (agents.some((agent) => agent.id === newId)) nextOrder.push(newId)
  return { hiddenAgentIds: [...hidden], agentOrder: nextOrder }
}
