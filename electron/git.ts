// 真实 Git 集成（GIT-001/002/003/004）：通过 git CLI 在主进程执行，
// execFile 不经 shell，路径以 `--` 分隔，避免参数注入（§9.3）。
import { ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { assertAllowedCwd } from './pathSafe'
import { sanitizeGitLogLimit } from './gitLimit'

export interface GitFile {
  path: string
  oldPath?: string
  /** index 状态码（暂存区） */
  index: string
  /** 工作树状态码 */
  worktree: string
  staged: boolean
}

export interface GitStatus {
  isRepo: boolean
  branch: string
  ahead: number
  behind: number
  files: GitFile[]
}

export interface GitLogEntry {
  hash: string
  author: string
  date: string
  message: string
}

interface GitResult {
  stdout: string
  stderr: string
  code: number
}

function git(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: 20 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code: (err as NodeJS.ErrnoException).code ? 1 : (err as any).status ?? 1 })
        } else {
          resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code: 0 })
        }
      },
    )
  })
}

async function getStatus(cwd: string): Promise<GitStatus> {
  const rev = await git(cwd, ['rev-parse', '--is-inside-work-tree'])
  if (rev.code !== 0 || rev.stdout.trim() !== 'true') {
    return { isRepo: false, branch: '', ahead: 0, behind: 0, files: [] }
  }
  const st = await git(cwd, ['status', '--porcelain=v1', '-b', '-z'])
  const parts = st.stdout.split('\0')
  let branch = ''
  let ahead = 0
  let behind = 0
  const files: GitFile[] = []
  let i = 0
  while (i < parts.length && parts[i] === '') i++
  if (i < parts.length && parts[i].startsWith('## ')) {
    const head = parts[i].slice(3)
    const am = head.match(/\[ahead\s+(\d+)(?:,\s*behind\s+(\d+))?\]/)
    const bm = head.match(/\[behind\s+(\d+)\]/)
    if (am) {
      ahead = parseInt(am[1], 10)
      if (am[2]) behind = parseInt(am[2], 10)
    } else if (bm) {
      behind = parseInt(bm[1], 10)
    }
    branch = head.replace(/\s*\[.*\]$/, '').split('...')[0].trim()
    i++
  }
  while (i < parts.length) {
    const entry = parts[i]
    if (entry === '' || entry.length < 3) {
      i++
      continue
    }
    const index = entry[0]
    const worktree = entry[1]
    // porcelain -z 重命名/复制：<XY> <新路径>\0<原路径>\0
    let p = entry.slice(3)
    let oldPath: string | undefined
    if (index === 'R' || index === 'C') {
      oldPath = parts[i + 1] // 原路径
      // p 已是 entry.slice(3) = 新路径
      i += 2
    } else {
      i++
    }
    files.push({ path: p, oldPath, index, worktree, staged: index !== ' ' && index !== '?' })
  }
  return { isRepo: true, branch, ahead, behind, files }
}

async function getDiff(cwd: string, opts: { staged?: boolean; path?: string }): Promise<string> {
  const args = ['diff']
  if (opts.staged) args.push('--cached')
  args.push('--')
  if (opts.path) args.push(opts.path)
  const r = await git(cwd, args)
  return r.stdout
}

async function stage(cwd: string, paths: string[]): Promise<void> {
  if (!paths.length) return
  const r = await git(cwd, ['add', '--', ...paths])
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'git add 失败')
}

async function unstage(cwd: string, paths: string[]): Promise<void> {
  if (!paths.length) return
  const r = await git(cwd, ['restore', '--staged', '--', ...paths])
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'git restore 失败')
}

async function commit(cwd: string, message: string): Promise<void> {
  if (!message.trim()) throw new Error('提交信息不能为空')
  const r = await git(cwd, ['commit', '-m', message])
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'git commit 失败')
}

async function getLog(cwd: string, limit: number): Promise<GitLogEntry[]> {
  const r = await git(cwd, ['log', `-${limit}`, '--pretty=format:%H%x1f%an%x1f%ad%x1f%s', '--date=short'])
  if (r.code !== 0) return []
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, author, date, message] = line.split('\x1f')
      return { hash, author, date, message }
    })
}

async function getBranches(cwd: string): Promise<{ name: string; current: boolean }[]> {
  const r = await git(cwd, ['branch', '--list', '--format=%(HEAD)%00%(refname:short)'])
  if (r.code !== 0) return []
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [head, name] = line.split('\0')
      return { name, current: head === '*' }
    })
}

async function checkout(cwd: string, branch: string): Promise<void> {
  if (!branch || branch.startsWith('-')) throw new Error('无效分支名')
  const r = await git(cwd, ['checkout', branch])
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'git checkout 失败')
}

function gated<T>(cwd: string, fn: (abs: string) => T): T {
  return fn(assertAllowedCwd(cwd))
}

export function registerGitHandlers() {
  ipcMain.handle('git:status', (_e, cwd: string) => gated(cwd, getStatus))
  ipcMain.handle('git:diff', (_e, cwd: string, opts: { staged?: boolean; path?: string }) =>
    gated(cwd, (abs) => getDiff(abs, opts ?? {})),
  )
  ipcMain.handle('git:stage', (_e, cwd: string, paths: string[]) => gated(cwd, (abs) => stage(abs, paths)))
  ipcMain.handle('git:unstage', (_e, cwd: string, paths: string[]) => gated(cwd, (abs) => unstage(abs, paths)))
  ipcMain.handle('git:commit', (_e, cwd: string, message: string) => gated(cwd, (abs) => commit(abs, message)))
  ipcMain.handle('git:log', (_e, cwd: string, limit?: number) =>
    gated(cwd, (abs) => getLog(abs, sanitizeGitLogLimit(limit))),
  )
  ipcMain.handle('git:branches', (_e, cwd: string) => gated(cwd, getBranches))
  ipcMain.handle('git:checkout', (_e, cwd: string, branch: string) => gated(cwd, (abs) => checkout(abs, branch)))
}
