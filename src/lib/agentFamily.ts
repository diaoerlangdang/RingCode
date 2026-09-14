import type { AgentDef, CloneFamily, Session } from '@/types'

const CLONE_FAMILIES: CloneFamily[] = ['claude', 'codex']
const BUILTIN_IDS = new Set(['claude', 'codex', 'opencode', 'antigravity', 'hermes'])

export function isCloneFamily(value: string | undefined): value is CloneFamily {
  return value === 'claude' || value === 'codex'
}

export function isCloneAgent<T extends Pick<AgentDef, 'id' | 'sourceFamily'>>(
  agent: T | undefined,
): agent is T & { sourceFamily: CloneFamily } {
  return !!agent && isCloneFamily(agent.sourceFamily) && agent.id !== agent.sourceFamily
}

export function cloneableSource(agent: AgentDef | undefined): AgentDef | undefined {
  if (!agent || isCloneAgent(agent)) return undefined
  return CLONE_FAMILIES.includes(agent.id as CloneFamily) ? agent : undefined
}

export function agentFamilyOf(agent: Pick<AgentDef, 'id' | 'sourceFamily'> | undefined): string {
  if (!agent) return ''
  if (isCloneFamily(agent.sourceFamily)) return agent.sourceFamily
  return agent.id
}

export function familyOfTool(tool: string, extra: AgentDef[] = []): string {
  if (BUILTIN_IDS.has(tool)) return tool
  const agent = extra.find((item) => item.id === tool)
  if (agent) return agentFamilyOf(agent)
  return tool
}

export function historyRootTool(tool: string, extra: AgentDef[] = []): string {
  const family = familyOfTool(tool, extra)
  if (family === 'claude' || family === 'codex' || family === 'hermes') return family
  return tool
}

export function usesCurrentEntryConfig(tool: string, extra: AgentDef[] = []): boolean {
  const family = familyOfTool(tool, extra)
  return family === 'claude' || family === 'codex'
}

export function migrateSessionCloneFields(session: Session, extra: AgentDef[] = []): Session {
  const family = session.family?.trim() || familyOfTool(session.tool, extra)
  const lastCloneId =
    session.lastCloneId?.trim() ||
    (family === 'claude' || family === 'codex' ? session.tool : undefined)
  return { ...session, family, lastCloneId }
}
