export const UNKNOWN_DISK_HISTORY_DIRECTORY = '__unknown__'

export interface DiskHistoryRecord {
  tool: string
  projectPath: string
  sessionFile: string
  sessionId: string
  title: string
  snippet: string
  searchText: string
  startedAt: number
  mtime: number
}

export type DiskHistoryItem = Omit<DiskHistoryRecord, 'searchText'>

export interface DiskHistoryGroupSummary {
  key: string
  path: string
  name: string
  totalCount: number
  matchedCount: number
  latestMtime: number
  available: boolean
  unknown: boolean
}

export interface DiskHistoryFilter {
  query: string
  tool: string
}

export interface DiskHistoryPageInput extends DiskHistoryFilter {
  directoryKey: string
  offset: number
  limit: number
}

export interface DiskHistoryPage {
  items: DiskHistoryItem[]
  total: number
}

export function normalizeDiskHistoryPath(input: string): string {
  const value = input.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return value || UNKNOWN_DISK_HISTORY_DIRECTORY
}

function directoryName(input: string): string {
  if (!input.trim()) return '未知目录'
  const cleaned = input.trim().replace(/[\\/]+$/, '')
  return cleaned.split(/[\\/]/).filter(Boolean).pop() ?? cleaned
}

function toolMatches(record: DiskHistoryRecord, tool: string): boolean {
  return !tool || tool === 'all' || record.tool === tool
}

function queryMatches(record: DiskHistoryRecord, query: string, directoryHit: boolean): boolean {
  if (!query || directoryHit) return true
  return `${record.title}\n${record.searchText}`.toLowerCase().includes(query)
}

function publicRecord(record: DiskHistoryRecord): DiskHistoryItem {
  const { searchText: _searchText, ...item } = record
  return item
}

export function buildDiskHistoryGroups(
  records: DiskHistoryRecord[],
  filter: DiskHistoryFilter,
  availability: ReadonlyMap<string, boolean> = new Map(),
): DiskHistoryGroupSummary[] {
  const source = new Map<string, { path: string; records: DiskHistoryRecord[] }>()
  for (const record of records) {
    const key = normalizeDiskHistoryPath(record.projectPath)
    const found = source.get(key)
    if (found) found.records.push(record)
    else source.set(key, { path: record.projectPath.trim(), records: [record] })
  }

  const query = filter.query.trim().toLowerCase()
  const groups: DiskHistoryGroupSummary[] = []
  for (const [key, group] of source) {
    const pathText = `${group.path}\n${directoryName(group.path)}`.toLowerCase()
    const directoryHit = !!query && pathText.includes(query)
    const matched = group.records.filter(
      (record) => toolMatches(record, filter.tool) && queryMatches(record, query, directoryHit),
    )
    if (!matched.length) continue
    const unknown = key === UNKNOWN_DISK_HISTORY_DIRECTORY
    groups.push({
      key,
      path: group.path,
      name: directoryName(group.path),
      totalCount: group.records.length,
      matchedCount: matched.length,
      latestMtime: Math.max(...matched.map((record) => record.mtime)),
      available: unknown ? false : (availability.get(key) ?? true),
      unknown,
    })
  }
  return groups.sort(
    (a, b) => Number(a.unknown) - Number(b.unknown) || b.latestMtime - a.latestMtime || a.key.localeCompare(b.key),
  )
}

export function listDiskHistoryGroup(
  records: DiskHistoryRecord[],
  input: DiskHistoryPageInput,
): DiskHistoryPage {
  const query = input.query.trim().toLowerCase()
  const groupRecords = records.filter(
    (record) => normalizeDiskHistoryPath(record.projectPath) === input.directoryKey,
  )
  const path = groupRecords[0]?.projectPath ?? ''
  const directoryHit = !!query && `${path}\n${directoryName(path)}`.toLowerCase().includes(query)
  const matched = groupRecords
    .filter((record) => toolMatches(record, input.tool) && queryMatches(record, query, directoryHit))
    .sort((a, b) => b.mtime - a.mtime || a.sessionId.localeCompare(b.sessionId))
  const offset = Math.max(0, input.offset)
  const limit = Math.max(0, input.limit)
  return {
    items: matched.slice(offset, offset + limit).map(publicRecord),
    total: matched.length,
  }
}
