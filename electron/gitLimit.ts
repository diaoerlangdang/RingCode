const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500

export function sanitizeGitLogLimit(limit: unknown): number {
  const n = Number(limit)
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) return DEFAULT_LIMIT
  return n
}
