// 工作区路径校验（PRD §9.3）：渲染层传入的 root/cwd 必须已登记，且不得用绝对分段或 .. 逃逸。
import * as path from 'node:path'

let allowedRoots: string[] = []

function withSep(abs: string): string {
  return abs.endsWith(path.sep) ? abs : abs + path.sep
}

/** Windows 盘符大小写不参与比较（D:\foo 与 d:\foo 是同一路径） */
function rootKey(abs: string): string {
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}

export function setAllowedRoots(roots: string[]): void {
  allowedRoots = (roots ?? [])
    .filter((r): r is string => typeof r === 'string' && r.length > 0)
    .map((r) => path.resolve(r))
}

export function addAllowedRoot(rootPath: string): void {
  if (typeof rootPath !== 'string' || !rootPath) return
  const abs = path.resolve(rootPath)
  if (!allowedRoots.some((r) => rootKey(r) === rootKey(abs))) allowedRoots.push(abs)
}

export function isUnderAllowedRoot(absPath: string): boolean {
  if (typeof absPath !== 'string' || !absPath) return false
  const resolved = path.resolve(absPath)
  const k = rootKey(resolved)
  return allowedRoots.some((root) => {
    const rk = rootKey(root)
    return k === rk || k.startsWith(withSep(rk))
  })
}

export function assertAllowedRoot(rootPath: string): string {
  if (!rootPath) throw new Error('未打开工作区')
  const rootAbs = path.resolve(rootPath)
  const match = allowedRoots.find((r) => rootKey(r) === rootKey(rootAbs))
  if (!match) {
    throw new Error(`路径未登记为工作区：${rootAbs}`)
  }
  return match
}

export function assertAllowedCwd(cwd: string): string {
  if (typeof cwd !== 'string' || !cwd) throw new Error('非法工作目录')
  const abs = path.resolve(cwd)
  if (!isUnderAllowedRoot(abs)) throw new Error(`路径未登记为工作区：${abs}`)
  return abs
}

/** 把 rootPath + segments 解析为绝对路径，禁止绝对分段和越界 */
export function resolveSafe(rootPath: string, segments: string[]): string {
  if (!rootPath) throw new Error('未打开工作区')
  const segs = segments ?? []
  for (const s of segs) {
    if (typeof s !== 'string' || s.includes('\0') || path.isAbsolute(s)) {
      throw new Error('非法路径分段')
    }
  }
  const rootAbs = assertAllowedRoot(rootPath)
  const resolved = path.resolve(rootAbs, ...segs)
  const rootWithSep = withSep(rootAbs)
  if (resolved !== rootAbs && !resolved.startsWith(rootWithSep)) {
    throw new Error('路径越界：禁止访问工作区之外')
  }
  return resolved
}
