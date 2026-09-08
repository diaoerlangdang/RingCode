// 工作区内容/文件名搜索（PRD FIL-004）。主进程递归遍历，渲染层不可直接访问磁盘（§9.3）。
import { ipcMain } from 'electron'
import * as path from 'node:path'
import { promises as fsp } from 'node:fs'
import { assertAllowedCwd } from './pathSafe'

export interface SearchMatch {
  /** 相对路径（posix 分隔符） */
  path: string
  /** 1-based 行号；filename 模式为 0 */
  line: number
  /** 匹配行内容（content 模式，截断 200 字符）；filename 模式为文件名 */
  text: string
}

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '__pycache__', '.svn', '.hg', '.idea', '.vscode',
  'dist', 'build', '.next', 'out', 'target', '.cache',
])
const MAX_FILE_SIZE = 1024 * 1024 // 1MB：跳过过大文件
const MAX_MATCHES = 200
const NUL = String.fromCharCode(0) // 用于检测二进制文件

function isLikelyBinaryName(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|ico|bmp|tiff?|pdf|zip|gz|tar|rar|7z|exe|dll|so|dylib|class|jar|war|wasm|mp[34]|wav|ogg|flac|avi|mov|mkv|ttf|otf|woff2?|eot|sqlite3?|db|lock|pyc|pyo|min\.js|chunk\.js)$/i.test(name)
}

async function walkFiles(root: string, rel = ''): Promise<string[]> {
  const out: string[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const relPath = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      out.push(...(await walkFiles(path.join(root, e.name), relPath)))
    } else if (e.isFile()) {
      out.push(relPath)
    }
  }
  return out
}

export function registerSearchHandlers(): void {
  ipcMain.handle(
    'search:workspace',
    async (_e, rootPath: string, query: string, mode: 'content' | 'filename'): Promise<SearchMatch[]> => {
      if (typeof rootPath !== 'string' || !path.isAbsolute(rootPath)) throw new Error('非法路径')
      assertAllowedCwd(rootPath)
      if (typeof query !== 'string' || !query.trim()) return []
      const q = query.toLowerCase()
      const files = await walkFiles(rootPath)
      const matches: SearchMatch[] = []

      if (mode === 'filename') {
        for (const rel of files) {
          if (path.basename(rel).toLowerCase().includes(q)) {
            matches.push({ path: rel, line: 0, text: path.basename(rel) })
            if (matches.length >= MAX_MATCHES) break
          }
        }
        return matches
      }

      // content 模式：逐文件读取、按行匹配
      for (const rel of files) {
        if (matches.length >= MAX_MATCHES) break
        if (isLikelyBinaryName(rel)) continue
        const abs = path.join(rootPath, ...rel.split('/'))
        let st: import('node:fs').Stats
        try {
          st = await fsp.stat(abs)
        } catch {
          continue
        }
        if (st.size > MAX_FILE_SIZE) continue
        let content: string
        try {
          content = await fsp.readFile(abs, 'utf8')
        } catch {
          continue
        }
        if (content.includes(NUL)) continue // 含空字节，判定为二进制文件跳过
        const lines = content.split(/\r?\n/)
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(q)) {
            matches.push({ path: rel, line: i + 1, text: lines[i].trim().slice(0, 200) })
            if (matches.length >= MAX_MATCHES) break
          }
        }
      }
      return matches
    },
  )
}
