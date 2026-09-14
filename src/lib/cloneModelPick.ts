/** 打开下拉看全部；只有正在输入时才按关键字筛。 */
export function visibleCloneModels(models: string[], query: string, filtering: boolean): string[] {
  if (!filtering) return models
  const q = query.trim().toLowerCase()
  if (!q) return models
  return models.filter((id) => id.toLowerCase().includes(q))
}
