export interface FileEntryContextPath {
  /** 父目录路径段，不包含节点名称。 */
  segs: string[]
  name: string
  isDir: boolean
}

/** 把树节点完整路径转换成右键菜单约定的“父目录 + 节点名”。 */
export function fileEntryContextFromTreePath(
  pathSegments: string[],
  isDir: boolean,
): FileEntryContextPath | null {
  const name = pathSegments[pathSegments.length - 1]
  if (!name) return null
  return { segs: pathSegments.slice(0, -1), name, isDir }
}

/** 把右键菜单上下文还原成文件操作所需的完整路径。 */
export function fileEntryTargetSegments(entry: Pick<FileEntryContextPath, 'segs' | 'name'>): string[] {
  return [...entry.segs, entry.name]
}
