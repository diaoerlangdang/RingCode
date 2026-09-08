/** Windows 路径小工具（工作区根、拖拽插入 Agent 用） */

export function isDriveRoot(p: string): boolean {
  return /^[a-zA-Z]:[\\/]?$/.test(p.trim())
}

export function joinWinPath(root: string, segments: string[] = []): string {
  const r = root.replace(/[\\/]+$/, '')
  if (!segments.length) return /^[a-zA-Z]:$/.test(r) ? r + '\\' : r
  return [r, ...segments].join('\\')
}
