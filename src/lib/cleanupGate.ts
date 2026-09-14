let blocked = false

export function setCleanupGate(value: boolean): void {
  blocked = value
}

export function isCleanupBlocked(): boolean {
  return blocked
}
