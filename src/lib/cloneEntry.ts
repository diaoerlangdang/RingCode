import { agentById, listAgents } from './agents'
import { agentFamilyOf, familyOfTool, isCloneAgent, usesCurrentEntryConfig } from './agentFamily'
import type { AgentDef, Session, TerminalTab } from '@/types'

export type EntryFallback = 'deleted' | 'unlinked-disk' | 'legacy-creator'

export interface ResolvedCloneEntry {
  agentId: string
  family: string
  fallback?: EntryFallback
  label: string
}

export function familyOriginalId(family: string): string {
  return family
}

export function agentsInFamily(family: string, extra: AgentDef[] = []): AgentDef[] {
  return listAgents(extra).filter((agent) => agentFamilyOf(agent) === family)
}

export function historyLaunchLockKey(input: {
  nativeSessionId?: string
  sessionId?: string
  family?: string
  tool?: string
}): string {
  if (input.nativeSessionId) return `native:${input.family || input.tool || 'tool'}:${input.nativeSessionId}`
  return `session:${input.sessionId || 'unknown'}`
}

function validFamilyEntry(agentId: string, family: string, extra: AgentDef[]): AgentDef | undefined {
  const agent = agentById(agentId, extra)
  if (!agent || familyOfTool(agent.id, extra) !== family) return undefined
  return agent
}

export function resolveCloneEntry(input: {
  tool: string
  family?: string
  lastCloneId?: string
  preferredEntryId?: string
  extra?: AgentDef[]
  diskUnlinked?: boolean
}): ResolvedCloneEntry {
  const extra = input.extra ?? []
  const family = input.family?.trim() || familyOfTool(input.tool, extra)
  const originalId = familyOriginalId(family)
  const original = agentById(originalId, extra)
  const originalLabel = original?.name ?? originalId

  if (!usesCurrentEntryConfig(family, extra)) {
    const agent = agentById(input.tool, extra)
    return { agentId: input.tool, family, label: agent?.name ?? input.tool }
  }

  const preferred = input.preferredEntryId?.trim()
  if (preferred) {
    const agent = validFamilyEntry(preferred, family, extra)
    if (agent) return { agentId: agent.id, family, label: agent.name }
  }

  if (input.diskUnlinked) {
    return { agentId: originalId, family, fallback: 'unlinked-disk', label: originalLabel }
  }

  const last = input.lastCloneId?.trim()
  if (last && agentById(last, extra) && familyOfTool(last, extra) === family) {
    return { agentId: last, family, label: agentById(last, extra)!.name }
  }
  if (last && !agentById(last, extra)) {
    return { agentId: originalId, family, fallback: 'deleted', label: originalLabel }
  }
  if (agentById(input.tool, extra) && familyOfTool(input.tool, extra) === family) {
    return {
      agentId: input.tool,
      family,
      fallback: last ? undefined : 'legacy-creator',
      label: agentById(input.tool, extra)!.name,
    }
  }
  return { agentId: originalId, family, fallback: last ? 'deleted' : undefined, label: originalLabel }
}

export function continueEntryHint(resolution: ResolvedCloneEntry, extra: AgentDef[] = []): string {
  if (resolution.fallback === 'unlinked-disk') return '用原版继续'
  if (resolution.fallback === 'deleted') return '原分身已删除，使用原版'
  const agent = agentById(resolution.agentId, extra)
  if (agent && isCloneAgent(agent)) return `继续使用：${agent.name}`
  return `继续使用：${resolution.label}`
}

export function pickLinkedSession(
  sessions: Session[],
  terminals: TerminalTab[],
  match: { tool: string; sessionId: string },
): Session | undefined {
  const same = sessions.filter(
    (session) =>
      session.nativeSessionId === match.sessionId &&
      (session.family || session.tool) === match.tool,
  )
  if (!same.length) return undefined
  const running = same.find((session) =>
    terminals.some((terminal) => terminal.sessionId === session.id && !terminal.orphaned),
  )
  if (running) return running
  return [...same].sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0]
}

export function activeTerminalForSession(terminals: TerminalTab[], sessionId: string): TerminalTab | undefined {
  return terminals.find((terminal) => terminal.sessionId === sessionId && !terminal.orphaned)
}
