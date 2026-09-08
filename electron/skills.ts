// Skill 库主进程层（PRD §6.9 SKL-001/002/003，§8.1 Skill 实体）
// 导入：受控拷贝来源文件夹到 userData/skills/<id>/，计算内容指纹，
//       读取 SKILL.md frontmatter 取名称/描述。
// 安全（§9.3）：srcPath 必须为已存在的绝对路径；目标始终在受控目录下，id 由主进程生成。
import { app, ipcMain } from 'electron'
import * as path from 'node:path'
import { promises as fsp } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import type { Dirent, Stats } from 'node:fs'
import { assertSkillImportSize } from './skillLimits'

export interface SkillMeta {
  id: string
  name: string
  description: string
  source: 'local' | 'git'
  sourcePath: string
  scope: 'global' | 'workspace'
  workspaceId?: string
  fingerprint: string
  fileCount: number
  totalSize: number
  createdAt: number
  updatedAt: number
}

function skillsDir(): string {
  return path.join(app.getPath('userData'), 'skills')
}

function skillDir(id: string): string {
  return path.join(skillsDir(), id)
}

/** 拷贝时跳过的目录/文件名 */
const SKIP_NAMES = new Set(['.git', 'node_modules', '__pycache__', '.svn', '.hg', '.DS_Store', '.idea', '.vscode'])

async function copyFiltered(src: string, dest: string): Promise<void> {
  await fsp.cp(src, dest, {
    recursive: true,
    filter: (s: string) => {
      if (s === src) return true
      return !SKIP_NAMES.has(path.basename(s))
    },
  })
}

/** 递归收集所有文件相对路径（posix 分隔符） */
async function walkFiles(root: string, rel = ''): Promise<string[]> {
  const out: string[] = []
  let entries: Dirent[]
  try {
    entries = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const relPath = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) {
      out.push(...(await walkFiles(path.join(root, e.name), relPath)))
    } else if (e.isFile()) {
      out.push(relPath)
    }
  }
  return out
}

/** 内容指纹：对全部文件按相对路径排序后，拼接 (relPath + 文件 SHA-256) 再取 SHA-256 */
async function computeFingerprint(root: string, files: string[]): Promise<string> {
  const h = createHash('sha256')
  for (const rel of [...files].sort()) {
    const content = await fsp.readFile(path.join(root, ...rel.split('/')))
    const fileHash = createHash('sha256').update(content).digest('hex')
    h.update(rel + '\0' + fileHash + '\0')
  }
  return h.digest('hex')
}

/** 解析 SKILL.md 头部 YAML frontmatter 的 name/description */
function parseFrontmatter(text: string): { name?: string; description?: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return {}
  const block = m[1]
  const get = (key: string): string | undefined => {
    const line = block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
    return line ? line[1].replace(/^["']|["']$/g, '').trim() : undefined
  }
  return { name: get('name'), description: get('description') }
}

/** 读取 Skill 主 Markdown：优先 SKILL.md，其次根目录任意 .md */
async function readSkillMd(root: string): Promise<{ name?: string; description?: string; text: string } | null> {
  const candidates = ['SKILL.md', 'skill.md', 'Skill.md']
  let mdName: string | null = null
  for (const c of candidates) {
    try {
      await fsp.access(path.join(root, c))
      mdName = c
      break
    } catch {
      /* 不存在则继续 */
    }
  }
  if (!mdName) {
    try {
      const entries = await fsp.readdir(root, { withFileTypes: true })
      const md = entries.find((e) => e.isFile() && /\.md$/i.test(e.name))
      if (md) mdName = md.name
    } catch {
      /* ignore */
    }
  }
  if (!mdName) return null
  const text = await fsp.readFile(path.join(root, mdName), 'utf8')
  return { ...parseFrontmatter(text), text }
}

export function registerSkillHandlers(): void {
  ipcMain.handle(
    'skill:import',
    async (_e, srcPath: string, scope: 'global' | 'workspace', workspaceId?: string): Promise<SkillMeta> => {
      if (typeof srcPath !== 'string' || !path.isAbsolute(srcPath)) throw new Error('非法来源路径')
      let st: Stats
      try {
        st = await fsp.stat(srcPath)
      } catch {
        throw new Error('来源文件夹不存在')
      }
      if (!st.isDirectory()) throw new Error('来源不是文件夹')
      if (scope !== 'global' && scope !== 'workspace') throw new Error('非法作用域')

      const id = randomUUID()
      const dest = skillDir(id)
      const srcFiles = await walkFiles(srcPath)
      let srcSize = 0
      for (const rel of srcFiles) {
        try {
          srcSize += (await fsp.stat(path.join(srcPath, ...rel.split('/')))).size
        } catch {
          /* ignore */
        }
      }
      assertSkillImportSize(srcSize)
      await fsp.mkdir(skillsDir(), { recursive: true })
      try {
        await copyFiltered(srcPath, dest)
      } catch (e) {
        await fsp.rm(dest, { recursive: true, force: true }).catch(() => {})
        throw new Error('导入失败：' + (e as Error).message)
      }

      const files = await walkFiles(dest)
      let totalSize = 0
      for (const rel of files) {
        try {
          totalSize += (await fsp.stat(path.join(dest, ...rel.split('/')))).size
        } catch {
          /* 忽略个别 stat 失败 */
        }
      }
      try {
        assertSkillImportSize(totalSize)
      } catch (e) {
        await fsp.rm(dest, { recursive: true, force: true }).catch(() => {})
        throw e
      }
      const fingerprint = await computeFingerprint(dest, files)
      const md = await readSkillMd(dest)
      const name = md?.name || path.basename(srcPath)
      const description = md?.description || ''
      const ts = Date.now()
      return {
        id,
        name,
        description,
        source: 'local',
        sourcePath: srcPath,
        scope,
        workspaceId: scope === 'workspace' ? workspaceId : undefined,
        fingerprint,
        fileCount: files.length,
        totalSize,
        createdAt: ts,
        updatedAt: ts,
      }
    },
  )

  ipcMain.handle('skill:readContent', async (_e, id: string): Promise<string | null> => {
    if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('非法 id')
    const md = await readSkillMd(skillDir(id))
    return md?.text ?? null
  })

  ipcMain.handle('skill:delete', async (_e, id: string): Promise<boolean> => {
    if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('非法 id')
    await fsp.rm(skillDir(id), { recursive: true, force: true })
    return true
  })
}
