const latestAttempt = new Map<string, string>()
const snapshots = new Map<string, { entryId: string; previous?: string; committed: boolean }>()

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function beginLaunchAttempt(sessionId: string, entryId: string, previous?: string): string {
  const attemptId = newId()
  latestAttempt.set(sessionId, attemptId)
  snapshots.set(attemptId, { entryId, previous, committed: false })
  return attemptId
}

export function isLatestLaunchAttempt(sessionId: string, attemptId: string | undefined): boolean {
  return !!attemptId && latestAttempt.get(sessionId) === attemptId
}

export function markLaunchAttemptCommitted(attemptId: string | undefined): void {
  if (!attemptId) return
  const snap = snapshots.get(attemptId)
  if (snap) snap.committed = true
}

export function revertLaunchAttemptIfLatest(
  sessionId: string,
  attemptId: string | undefined,
): { previous?: string; entryId: string } | undefined {
  if (!isLatestLaunchAttempt(sessionId, attemptId) || !attemptId) return undefined
  const snap = snapshots.get(attemptId)
  if (!snap?.committed) return undefined
  return { previous: snap.previous, entryId: snap.entryId }
}
