/** PowerShell 安全引用路径，供拖入终端使用 */
export function quoteForShell(p: string): string {
  if (!p) return p
  if (!/[\s'"&()[\]{}`$]/.test(p)) return p
  return `'${p.replace(/'/g, "''")}'`
}
