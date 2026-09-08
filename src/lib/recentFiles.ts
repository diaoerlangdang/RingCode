import type { RecentFile } from '@/types'

function recentFileKey(workspaceId: string, segments: string[]): string {
  return `${workspaceId}:${segments.join('/')}`
}

export function withoutRecentFile(files: RecentFile[], workspaceId: string, segments: string[]): RecentFile[] {
  const target = recentFileKey(workspaceId, segments)
  return files.filter((file) => recentFileKey(file.workspaceId, file.segments) !== target)
}
