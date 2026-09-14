/** 复制重名：name →「stem - 副本.ext」→「stem - 副本 (2).ext」。文件夹不拆扩展名。 */
export function uniqueCopyName(name: string, isDir: boolean, existing: Set<string>): string {
  if (!existing.has(name)) return name
  const dot = isDir ? -1 : name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let candidate = `${stem} - 副本${ext}`
  let i = 2
  while (existing.has(candidate)) {
    candidate = `${stem} - 副本 (${i})${ext}`
    i += 1
  }
  return candidate
}

/** 复制可自动改名；剪切遇同名应失败，不偷偷改成副本。 */
export function resolvePasteDestName(input: {
  name: string
  isDir: boolean
  existing: Set<string>
  cut: boolean
}): { ok: true; destName: string } | { ok: false; reason: string } {
  if (input.cut) {
    if (input.existing.has(input.name)) {
      return { ok: false, reason: `目标已存在「${input.name}」，请先处理重名再移动` }
    }
    return { ok: true, destName: input.name }
  }
  return { ok: true, destName: uniqueCopyName(input.name, input.isDir, input.existing) }
}
