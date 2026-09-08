export const UNKNOWN_HISTORY_DIRECTORY = '__unknown__'

export type HistoryDirectoryRelation = 'root' | 'child' | 'other' | 'unknown'

export interface HistoryGroup<T> {
  key: string
  path: string
  name: string
  relation: HistoryDirectoryRelation
  totalCount: number
  matchedCount: number
  latestAt: number
  items: T[]
}

interface GroupOptions<T> {
  getId: (item: T) => string
  getDirectory: (item: T) => string
  getUpdatedAt: (item: T) => number
  getTool: (item: T) => string
  getSearchText: (item: T) => string
  activeWorkspacePath?: string
  query?: string
  tool?: string
}

export function normalizeHistoryPath(input: string): string {
  const value = input.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return value || UNKNOWN_HISTORY_DIRECTORY
}

export function historyDirectoryName(input: string): string {
  if (!input.trim()) return '未知目录'
  const cleaned = input.trim().replace(/[\\/]+$/, '')
  return cleaned.split(/[\\/]/).filter(Boolean).pop() ?? cleaned
}

export function historyDirectoryRelation(key: string, activeWorkspacePath?: string): HistoryDirectoryRelation {
  if (key === UNKNOWN_HISTORY_DIRECTORY) return 'unknown'
  const active = normalizeHistoryPath(activeWorkspacePath ?? '')
  if (active === UNKNOWN_HISTORY_DIRECTORY) return 'other'
  if (key === active) return 'root'
  return key.startsWith(`${active}/`) ? 'child' : 'other'
}

function relationRank(relation: HistoryDirectoryRelation): number {
  if (relation === 'root') return 0
  if (relation === 'child') return 1
  if (relation === 'other') return 2
  return 3
}

export function groupHistoryItems<T>(items: T[], options: GroupOptions<T>): HistoryGroup<T>[] {
  const all = new Map<string, { path: string; items: T[] }>()
  for (const item of items) {
    const path = options.getDirectory(item).trim()
    const key = normalizeHistoryPath(path)
    const found = all.get(key)
    if (found) found.items.push(item)
    else all.set(key, { path, items: [item] })
  }

  const query = (options.query ?? '').trim().toLowerCase()
  const tool = options.tool && options.tool !== 'all' ? options.tool : ''
  const groups: HistoryGroup<T>[] = []

  for (const [key, source] of all) {
    const pathText = `${source.path}\n${historyDirectoryName(source.path)}`.toLowerCase()
    const directoryHit = !!query && pathText.includes(query)
    const matched = source.items.filter((item) => {
      if (tool && options.getTool(item) !== tool) return false
      if (!query || directoryHit) return true
      return options.getSearchText(item).toLowerCase().includes(query)
    })
    if (!matched.length) continue
    matched.sort(
      (a, b) =>
        options.getUpdatedAt(b) - options.getUpdatedAt(a) ||
        options.getId(a).localeCompare(options.getId(b)),
    )
    groups.push({
      key,
      path: source.path,
      name: historyDirectoryName(source.path),
      relation: historyDirectoryRelation(key, options.activeWorkspacePath),
      totalCount: source.items.length,
      matchedCount: matched.length,
      latestAt: Math.max(...matched.map(options.getUpdatedAt)),
      items: matched,
    })
  }

  return groups.sort(
    (a, b) =>
      relationRank(a.relation) - relationRank(b.relation) ||
      b.latestAt - a.latestAt ||
      a.key.localeCompare(b.key),
  )
}

export function defaultExpandedHistoryGroups<T>(
  groups: HistoryGroup<T>[],
  _activeWorkspacePath?: string,
): string[] {
  const root = groups.find((group) => group.relation === 'root')
  if (root) return [root.key]
  const first = groups.find((group) => group.relation !== 'unknown')
  return first ? [first.key] : []
}

export function pageHistoryItems<T>(items: T[], visibleCount = 30): T[] {
  return items.slice(0, Math.max(0, visibleCount))
}

export function sortHistoryGroupsForWorkspace<T>(
  groups: T[],
  activeWorkspacePath: string | undefined,
  getPath: (group: T) => string,
  getLatestAt: (group: T) => number,
  isUnknown: (group: T) => boolean,
): T[] {
  return [...groups].sort((a, b) => {
    const relationA = isUnknown(a)
      ? 'unknown'
      : historyDirectoryRelation(normalizeHistoryPath(getPath(a)), activeWorkspacePath)
    const relationB = isUnknown(b)
      ? 'unknown'
      : historyDirectoryRelation(normalizeHistoryPath(getPath(b)), activeWorkspacePath)
    return (
      relationRank(relationA) - relationRank(relationB) ||
      getLatestAt(b) - getLatestAt(a) ||
      normalizeHistoryPath(getPath(a)).localeCompare(normalizeHistoryPath(getPath(b)))
    )
  })
}

export function resolveHistoryExpansion<T>(
  groups: HistoryGroup<T>[],
  saved: Record<string, boolean>,
  activeWorkspacePath?: string,
): Record<string, boolean> {
  const defaults = new Set(defaultExpandedHistoryGroups(groups, activeWorkspacePath))
  return Object.fromEntries(
    groups.map((group) => [
      group.key,
      Object.prototype.hasOwnProperty.call(saved, group.key) ? !!saved[group.key] : defaults.has(group.key),
    ]),
  )
}

export function setVisibleHistoryExpansion(
  saved: Record<string, boolean>,
  visibleKeys: string[],
  expanded: boolean,
): Record<string, boolean> {
  const next = { ...saved }
  for (const key of visibleKeys) next[key] = expanded
  return next
}
