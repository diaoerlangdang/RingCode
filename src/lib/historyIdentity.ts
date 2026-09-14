import { familyOfTool, historyRootTool } from './agentFamily'
import type { AgentDef } from '@/types'

export function historyAliasKey(tool: string, nativeSessionId: string): string {
  return `${tool}:${nativeSessionId}`
}

export function canonicalHistoryKey(family: string, nativeSessionId: string): string {
  return `${family}:${nativeSessionId}`
}

export function historyKeysForLookup(tool: string, nativeSessionId: string, extra: AgentDef[] = []): string[] {
  const family = familyOfTool(tool, extra)
  const keys = [canonicalHistoryKey(family, nativeSessionId)]
  if (tool !== family) keys.push(historyAliasKey(tool, nativeSessionId))
  return [...new Set(keys)]
}

export function lookupHistoryAlias(
  aliases: Record<string, string>,
  tool: string,
  nativeSessionId: string,
  extra: AgentDef[] = [],
): string | undefined {
  for (const key of historyKeysForLookup(tool, nativeSessionId, extra)) {
    const value = aliases[key]
    if (value) return value
  }
  return undefined
}

export function migrateHistoryAliasKeys(
  aliases: Record<string, string>,
  extra: AgentDef[] = [],
): Record<string, string> {
  const next = { ...aliases }
  for (const [key, value] of Object.entries(aliases)) {
    const split = key.indexOf(':')
    if (split <= 0) continue
    const tool = key.slice(0, split)
    const nativeSessionId = key.slice(split + 1)
    if (!nativeSessionId) continue
    const family = familyOfTool(tool, extra)
    const canonical = canonicalHistoryKey(family, nativeSessionId)
    if (!next[canonical]) next[canonical] = value
  }
  return next
}

export { historyRootTool }
