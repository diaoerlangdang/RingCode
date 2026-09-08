import * as path from 'node:path'

export interface NativeSessionCandidate {
  projectPath: string
  nativeSessionId: string
  startedAt: number
  mtime: number
}

export interface NativeSessionLookup {
  projectPath: string
  startedAt: number
  excludeSessionId?: string
}

export function sameHistoryPath(a: string, b: string, platform = process.platform): boolean {
  if (!a || !b) return false
  const left = path.resolve(a).replace(/[\\/]+$/, '')
  const right = path.resolve(b).replace(/[\\/]+$/, '')
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

export function matchesRecentNativeSession(
  candidate: NativeSessionCandidate,
  lookup: NativeSessionLookup,
  platform = process.platform,
): boolean {
  if (!sameHistoryPath(candidate.projectPath, lookup.projectPath, platform)) return false
  if (candidate.startedAt < lookup.startedAt - 5_000) return false
  if (lookup.excludeSessionId && candidate.nativeSessionId === lookup.excludeSessionId) return false
  return true
}
