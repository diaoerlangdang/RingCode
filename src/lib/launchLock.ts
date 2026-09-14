const locks = new Set<string>()

export function acquireLaunchLock(key: string): boolean {
  if (!key || locks.has(key)) return false
  locks.add(key)
  return true
}

export function releaseLaunchLock(key: string): void {
  locks.delete(key)
}

export function hasLaunchLock(key: string): boolean {
  return locks.has(key)
}
