// 磁盘历史会话搜索（PRD HIS-014）：扫描 Claude Code / Codex 在本机留下的会话 jsonl。
// 主进程读取各 Agent 的公开历史接口或目录，渲染层不可直接访问磁盘（§9.3）。
import { ipcMain, shell } from 'electron'
import * as path from 'node:path'
import * as os from 'node:os'
import { promises as fsp } from 'node:fs'
import { execFile } from 'node:child_process'
import { matchesRecentNativeSession } from './historyMatch'
import { readHistoryPage, type HistoryFilePage } from './historyRead'
import { selectHistoryTitle } from './historyTitle'
import { parseCodexSessionIndex } from './codexHistory'
import {
  applyCliTitle,
  contentHasToolResult,
  shouldSkipHistoryBodyEvent,
} from './historyParse'
import {
  normalizeOpenCodeExport,
  parseOpenCodeSessionList,
  sessionIdFromOpenCodeUri,
} from './opencodeHistory'
import {
  antigravityConversationSummary,
  antigravityConversationUri,
  conversationIdFromAntigravityUri,
  parseAntigravityLastConversations,
} from './antigravityHistory'
import { resolveExecutablePath } from './executableResolver'
import {
  buildDiskHistoryGroups,
  listDiskHistoryGroup,
  normalizeDiskHistoryPath,
  type DiskHistoryGroupSummary,
  type DiskHistoryPage,
  type DiskHistoryPageInput,
  type DiskHistoryRecord,
} from './historyIndex'

export interface HistoryMatch {
  tool: string
  projectPath: string
  sessionFile: string
  sessionId: string
  title: string
  snippet: string
  startedAt: number
  mtime: number
}

const MAX_RESULTS = 50 // 兼容旧 history:search 接口；目录索引不受此限制
const MAX_FILE_SIZE = 2 * 1024 * 1024 // 单文件最多读取 2MB 正文用于索引
const MAX_LINES_PER_FILE = 4000 // 单文件最多扫描行数，避免超大文件拖慢
const MIN_STR_LEN = 4 // 过短字符串不计为可搜索正文
const CLI_MAX_BUFFER = 4 * 1024 * 1024
const CLI_TIMEOUT_MS = 15_000

let toolCommands: Record<string, string> = { opencode: 'opencode' }
const resolvedCommandCache = new Map<string, string>()
const openCodeExportCache = new Map<string, { updated: number; content: string; searchText: string }>()

async function resolveCommand(command: string): Promise<string> {
  const clean = command.trim()
  if (!clean) throw new Error('CLI command is empty')
  if (path.isAbsolute(clean)) return clean
  const cached = resolvedCommandCache.get(clean)
  if (cached) return cached
  if (process.platform !== 'win32') return clean
  const found = resolveExecutablePath(clean)
  resolvedCommandCache.set(clean, found)
  return found
}

async function runCli(command: string, args: string[], cwd?: string): Promise<string> {
  const resolved = await resolveCommand(command)
  const isScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)
  const exe = isScript ? process.env.ComSpec || 'cmd.exe' : resolved
  const finalArgs = isScript ? ['/d', '/s', '/c', resolved, ...args] : args
  return new Promise((resolve, reject) => {
    execFile(
      exe,
      finalArgs,
      { cwd: cwd || undefined, windowsHide: true, timeout: CLI_TIMEOUT_MS, maxBuffer: CLI_MAX_BUFFER },
      (error, stdout) => error ? reject(error) : resolve(stdout),
    )
  })
}

function wholeTextPage(content: string): HistoryFilePage {
  return { content, start: 0, end: Buffer.byteLength(content), hasMore: false }
}

/** 递归收集对象中的字符串值（用于通用 jsonl 正文提取） */
function collectStrings(obj: unknown, out: string[]): void {
  if (obj == null) return
  if (typeof obj === 'string') {
    const s = obj.trim()
    if (s.length >= MIN_STR_LEN) out.push(s)
    return
  }
  if (Array.isArray(obj)) {
    for (const x of obj) collectStrings(x, out)
    return
  }
  if (typeof obj === 'object') {
    for (const v of Object.values(obj as Record<string, unknown>)) collectStrings(v, out)
  }
}

/** 从 Claude Code 事件 content 提取可读文本（content 可能是 string 或 block 数组） */
function extractContentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      if (block && typeof block === 'object') {
        const b = block as Record<string, unknown>
        if (typeof b.text === 'string') parts.push(b.text)
        else if (b.type === 'tool_result') parts.push(extractContentText(b.content))
        else collectStrings(b, parts)
      }
    }
    return parts.join(' ')
  }
  return ''
}

interface ParsedSession {
  nativeSessionId: string
  projectPath: string
  title: string
  texts: string[]
  startedAt: number
  mtime: number
}

/** 解析单个会话 jsonl：提取项目路径、Agent 原生标题（缺失时首条用户消息）、全部正文文本 */
async function parseSession(file: string, tool: string): Promise<ParsedSession | null> {
  let st: import('node:fs').Stats
  try {
    st = await fsp.stat(file)
  } catch {
    return null
  }
  let raw: string
  try {
    if (st.size <= MAX_FILE_SIZE) {
      raw = await fsp.readFile(file, 'utf8')
    } else {
      const handle = await fsp.open(file, 'r')
      try {
        const buffer = Buffer.allocUnsafe(MAX_FILE_SIZE)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        raw = buffer.subarray(0, bytesRead).toString('utf8')
      } finally {
        await handle.close()
      }
    }
  } catch {
    return null
  }
  const lines = raw.split(/\r?\n/).slice(0, MAX_LINES_PER_FILE)
  let nativeSessionId = ''
  let projectPath = ''
  let title = ''
  const texts: string[] = []
  let firstUserText = ''
  let isSubagent = false
  let startedAt = st.birthtimeMs || st.ctimeMs || st.mtimeMs

  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    let ev: Record<string, unknown>
    try {
      ev = JSON.parse(t)
    } catch {
      continue
    }
    if (typeof ev.timestamp === 'string') {
      const ts = Date.parse(ev.timestamp)
      if (Number.isFinite(ts) && ts > 0) startedAt = Math.min(startedAt, ts)
    }
    if (typeof ev.cwd === 'string' && !projectPath) projectPath = ev.cwd
    if (typeof ev.sessionId === 'string' && !nativeSessionId) nativeSessionId = ev.sessionId
    if (typeof ev.session_id === 'string' && !nativeSessionId) nativeSessionId = ev.session_id
    const payload = ev.payload as Record<string, unknown> | undefined
    if (payload && typeof payload === 'object') {
      if (payload.thread_source === 'subagent') isSubagent = true
      const source = payload.source as Record<string, unknown> | undefined
      if (source && typeof source === 'object' && source.subagent) isSubagent = true
      if (typeof payload.cwd === 'string' && !projectPath) projectPath = payload.cwd
      if (typeof payload.id === 'string' && !nativeSessionId && /session|meta|conversation/i.test(String(ev.type ?? payload.type ?? ''))) {
        nativeSessionId = payload.id
      }
      if (typeof payload.session_id === 'string' && !nativeSessionId) nativeSessionId = payload.session_id
    }

    title = applyCliTitle(title, ev)
    if (shouldSkipHistoryBodyEvent(ev)) continue

    if (tool === 'codex' && payload && typeof payload === 'object') {
      if (payload.type === 'message' && (payload.role === 'user' || payload.role === 'assistant')) {
        const text = extractContentText(payload.content)
        if (text) {
          texts.push(text)
          if (payload.role === 'user' && !firstUserText) firstUserText = text
        }
      }
      // event_msg 与 response_item 常重复；仅在还没有用户正文时用作兜底。
      if (payload.type === 'user_message' && !firstUserText && typeof payload.message === 'string') {
        firstUserText = payload.message
        texts.push(payload.message)
      }
      continue
    }

    const msg = ev.message as Record<string, unknown> | undefined
    if (msg && typeof msg === 'object') {
      const role = msg.role
      const isToolResult = contentHasToolResult(msg.content)
      const text = extractContentText(msg.content)
      if (text && !isToolResult) {
        texts.push(text)
        if (role === 'user' && !firstUserText) firstUserText = text
      } else if (text) {
        texts.push(text)
      }
    } else {
      // 通用兜底：Hermes 等非 Claude 格式，递归收集字符串
      const parts: string[] = []
      collectStrings(ev, parts)
      if (parts.length) texts.push(parts.join(' '))
    }
  }

  if (isSubagent) return null
  title = selectHistoryTitle(title, firstUserText, texts[0] ?? '')
  return {
    nativeSessionId: nativeSessionId || path.basename(file, '.jsonl'),
    projectPath,
    title,
    texts,
    startedAt,
    mtime: st.mtimeMs,
  }
}

async function walkJsonl(root: string): Promise<string[]> {
  const out: string[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name.toLowerCase() === 'subagents') continue
      out.push(...(await walkJsonl(path.join(root, e.name))))
    } else if (e.isFile() && e.name.endsWith('.jsonl') && !/^agent-[^.]+\.jsonl$/i.test(e.name)) {
      out.push(path.join(root, e.name))
    }
  }
  return out
}

function snippetFor(texts: string[], q: string): string {
  if (!q) return (texts[0] ?? '').trim().slice(0, 200)
  for (const t of texts) {
    const i = t.toLowerCase().indexOf(q)
    if (i >= 0) {
      const start = Math.max(0, i - 40)
      return (start > 0 ? '…' : '') + t.slice(start, start + 200).trim()
    }
  }
  return (texts[0] ?? '').trim().slice(0, 200)
}

/** 内置 Agent 磁盘历史根目录（相对 homedir）。新增内置 Agent 时与 src/lib/agents.ts 同步。 */
const HISTORY_ROOTS: { id: string; rel: string }[] = [
  { id: 'claude', rel: path.join('.claude', 'projects') },
  { id: 'codex', rel: path.join('.codex', 'sessions') },
  { id: 'hermes', rel: '.hermes' },
]

const parsedFileCache = new Map<
  string,
  { mtime: number; size: number; record: DiskHistoryRecord | null }
>()
let historySnapshot: { at: number; records: DiskHistoryRecord[]; openCodeHydrated: boolean } | null = null

async function loadAntigravityRecords(): Promise<DiskHistoryRecord[]> {
  const file = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'cache', 'last_conversations.json')
  try {
    const [raw, stat] = await Promise.all([fsp.readFile(file, 'utf8'), fsp.stat(file)])
    return parseAntigravityLastConversations(raw, stat.mtimeMs)
  } catch {
    return []
  }
}

async function readOpenCodeExport(sessionId: string, directory: string, updated: number): Promise<{ content: string; searchText: string } | null> {
  const cached = openCodeExportCache.get(sessionId)
  if (cached && cached.updated === updated) return cached
  try {
    const raw = await runCli(toolCommands.opencode || 'opencode', ['export', sessionId], directory || undefined)
    const normalized = normalizeOpenCodeExport(raw)
    if (!normalized) return null
    const value = { ...normalized, updated }
    openCodeExportCache.set(sessionId, value)
    return value
  } catch {
    return null
  }
}

async function loadOpenCodeRecords(hydrateBody: boolean): Promise<DiskHistoryRecord[]> {
  let records: DiskHistoryRecord[]
  try {
    const raw = await runCli(toolCommands.opencode || 'opencode', ['session', 'list', '--format', 'json'])
    records = parseOpenCodeSessionList(raw)
  } catch {
    return []
  }
  if (!hydrateBody) return records
  for (let index = 0; index < records.length; index += 4) {
    await Promise.all(records.slice(index, index + 4).map(async (record) => {
      const exported = await readOpenCodeExport(record.sessionId, record.projectPath, record.mtime)
      if (!exported) return
      record.searchText = exported.searchText
      record.snippet = snippetFor(exported.searchText.split(/\r?\n/).filter(Boolean), '')
    }))
  }
  return records
}

let codexIndexCache: { mtime: number; size: number; names: Map<string, string> } | null = null

async function loadCodexThreadNames(): Promise<Map<string, string>> {
  const file = path.join(os.homedir(), '.codex', 'session_index.jsonl')
  try {
    const st = await fsp.stat(file)
    if (codexIndexCache && codexIndexCache.mtime === st.mtimeMs && codexIndexCache.size === st.size) {
      return codexIndexCache.names
    }
    const names = parseCodexSessionIndex(await fsp.readFile(file, 'utf8'))
    codexIndexCache = { mtime: st.mtimeMs, size: st.size, names }
    return names
  } catch {
    return codexIndexCache?.names ?? new Map()
  }
}

function overlayCodexTitle<T extends { tool: string; sessionId: string; title: string }>(
  record: T,
  names: Map<string, string>,
): T {
  if (record.tool !== 'codex') return record
  const named = names.get(record.sessionId)
  const title = selectHistoryTitle(named ?? '', record.title, '')
  return title && title !== record.title ? { ...record, title } : record
}

function toDiskRecord(file: string, tool: string, parsed: ParsedSession): DiskHistoryRecord {
  return {
    tool,
    projectPath: parsed.projectPath,
    sessionFile: file,
    sessionId: parsed.nativeSessionId,
    title: parsed.title.trim().slice(0, 120) || path.basename(file, '.jsonl'),
    snippet: snippetFor(parsed.texts, ''),
    searchText: parsed.texts.join('\n'),
    startedAt: parsed.startedAt,
    mtime: parsed.mtime,
  }
}

async function loadHistoryRecords(force = false, hydrateOpenCodeBody = false): Promise<DiskHistoryRecord[]> {
  if (
    !force &&
    historySnapshot &&
    Date.now() - historySnapshot.at < 5_000 &&
    (!hydrateOpenCodeBody || historySnapshot.openCodeHydrated)
  ) return historySnapshot.records
  const records: DiskHistoryRecord[] = []
  const seen = new Set<string>()
  const home = os.homedir()

  for (const root of HISTORY_ROOTS) {
    const files = await walkJsonl(path.join(home, root.rel))
    for (const file of files) {
      seen.add(file)
      let st: import('node:fs').Stats
      try {
        st = await fsp.stat(file)
      } catch {
        continue
      }
      const cached = parsedFileCache.get(file)
      if (cached && cached.mtime === st.mtimeMs && cached.size === st.size) {
        if (cached.record) records.push(cached.record)
        continue
      }
      const parsed = await parseSession(file, root.id)
      const record = parsed ? toDiskRecord(file, root.id, parsed) : null
      parsedFileCache.set(file, { mtime: st.mtimeMs, size: st.size, record })
      if (record) records.push(record)
    }
  }

  records.push(...(await loadAntigravityRecords()))
  records.push(...(await loadOpenCodeRecords(hydrateOpenCodeBody)))

  const codexNames = await loadCodexThreadNames()
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (record) records[i] = overlayCodexTitle(record, codexNames)
  }

  for (const file of parsedFileCache.keys()) {
    if (!seen.has(file)) parsedFileCache.delete(file)
  }
  records.sort((a, b) => b.mtime - a.mtime)
  historySnapshot = { at: Date.now(), records, openCodeHydrated: hydrateOpenCodeBody }
  return records
}

async function getDirectoryAvailability(records: DiskHistoryRecord[]): Promise<Map<string, boolean>> {
  const paths = new Map<string, string>()
  for (const record of records) {
    const key = normalizeDiskHistoryPath(record.projectPath)
    if (record.projectPath && !paths.has(key)) paths.set(key, record.projectPath)
  }
  const availability = new Map<string, boolean>()
  await Promise.all(
    [...paths].map(async ([key, directory]) => {
      try {
        const st = await fsp.stat(directory)
        availability.set(key, st.isDirectory())
      } catch {
        availability.set(key, false)
      }
    }),
  )
  return availability
}

async function resolveHistorySessionFile(tool: string, sessionId: string): Promise<string | null> {
  if (tool === 'opencode') return /^[a-zA-Z0-9_-]{4,160}$/.test(sessionId) ? `opencode://session/${encodeURIComponent(sessionId)}` : null
  if (tool === 'antigravity') {
    const uri = antigravityConversationUri(sessionId)
    return conversationIdFromAntigravityUri(uri) ? uri : null
  }
  if (!HISTORY_ROOTS.some((root) => root.id === tool)) return null
  let records = await loadHistoryRecords()
  let record = records.find((item) => item.tool === tool && item.sessionId === sessionId)
  if (!record) {
    records = await loadHistoryRecords(true)
    record = records.find((item) => item.tool === tool && item.sessionId === sessionId)
  }
  return record?.sessionFile ?? null
}

function isAllowedHistoryFile(file: string): boolean {
  if (typeof file !== 'string') return false
  if (sessionIdFromOpenCodeUri(file)) return true
  if (conversationIdFromAntigravityUri(file)) return true
  if (!file.endsWith('.jsonl')) return false
  const home = os.homedir()
  return HISTORY_ROOTS.some((root) => {
    const rel = path.relative(path.join(home, root.rel), file)
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
  })
}

async function readLatestHistoryPage(file: string): Promise<string | null> {
  const openCodeSessionId = sessionIdFromOpenCodeUri(file)
  if (openCodeSessionId) {
    const record = (await loadHistoryRecords()).find((item) => item.tool === 'opencode' && item.sessionId === openCodeSessionId)
    return (await readOpenCodeExport(openCodeSessionId, record?.projectPath ?? '', record?.mtime ?? 0))?.content ?? null
  }
  const antigravityConversationId = conversationIdFromAntigravityUri(file)
  if (antigravityConversationId) {
    const record = (await loadHistoryRecords()).find(
      (item) => item.tool === 'antigravity' && item.sessionId === antigravityConversationId,
    )
    return antigravityConversationSummary(record?.projectPath ?? '', antigravityConversationId)
  }
  try {
    return (await readHistoryPage(file)).content
  } catch {
    return null
  }
}

export function registerHistoryHandlers(): void {
  ipcMain.handle('history:setContext', (_e, input: { commands?: Record<string, string>; workspaces?: string[] }): void => {
    if (!input || typeof input !== 'object') return
    if (input.commands && typeof input.commands === 'object') {
      for (const id of ['opencode']) {
        const command = input.commands[id]
        if (typeof command === 'string' && command.trim()) toolCommands[id] = command.trim()
      }
      resolvedCommandCache.clear()
    }
    historySnapshot = null
  })

  ipcMain.handle('history:search', async (_e, query: string, tool: string = 'all'): Promise<HistoryMatch[]> => {
    const q = (typeof query === 'string' ? query : '').toLowerCase().trim()
    const want = typeof tool === 'string' && tool ? tool : 'all'
    const records = await loadHistoryRecords(false, !!q && (want === 'all' || want === 'opencode'))
    return records
      .filter((record) => want === 'all' || record.tool === want)
      .filter(
        (record) =>
          !q ||
          record.title.toLowerCase().includes(q) ||
          record.searchText.toLowerCase().includes(q) ||
          record.projectPath.toLowerCase().includes(q),
      )
      .slice(0, MAX_RESULTS)
      .map(({ searchText: _searchText, ...record }) => record)
  })

  ipcMain.handle(
    'history:groups',
    async (
      _e,
      input: { query?: string; tool?: string; refresh?: boolean } = {},
    ): Promise<DiskHistoryGroupSummary[]> => {
      const query = typeof input.query === 'string' ? input.query : ''
      const tool = typeof input.tool === 'string' ? input.tool : 'all'
      const records = await loadHistoryRecords(input.refresh === true, !!query.trim() && (tool === 'all' || tool === 'opencode'))
      const availability = await getDirectoryAvailability(records)
      return buildDiskHistoryGroups(
        records,
        {
          query,
          tool,
        },
        availability,
      )
    },
  )

  ipcMain.handle(
    'history:listGroup',
    async (_e, input: DiskHistoryPageInput): Promise<DiskHistoryPage> => {
      if (!input || typeof input.directoryKey !== 'string') return { items: [], total: 0 }
      const query = typeof input.query === 'string' ? input.query : ''
      const tool = typeof input.tool === 'string' ? input.tool : 'all'
      const records = await loadHistoryRecords(false, !!query.trim() && (tool === 'all' || tool === 'opencode'))
      return listDiskHistoryGroup(records, {
        directoryKey: input.directoryKey,
        query,
        tool,
        offset: Math.max(0, Number(input.offset) || 0),
        limit: Math.min(5_000, Math.max(1, Number(input.limit) || 30)),
      })
    },
  )

  ipcMain.handle('history:checkDirectories', async (_e, directories: string[]): Promise<Record<string, boolean>> => {
    if (!Array.isArray(directories)) return {}
    const unique = [...new Set(directories.filter((value) => typeof value === 'string' && value.trim()).slice(0, 500))]
    const out: Record<string, boolean> = {}
    await Promise.all(
      unique.map(async (directory) => {
        const key = normalizeDiskHistoryPath(directory)
        try {
          const st = await fsp.stat(directory)
          out[key] = st.isDirectory()
        } catch {
          out[key] = false
        }
      }),
    )
    return out
  })

  ipcMain.handle('history:openDirectory', async (_e, directory: string): Promise<boolean> => {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) return false
    try {
      const st = await fsp.stat(directory)
      if (!st.isDirectory()) return false
      return (await shell.openPath(directory)) === ''
    } catch {
      return false
    }
  })

  ipcMain.handle(
    'history:findRecent',
    async (
      _e,
      input: { tool: string; projectPath: string; startedAt: number; excludeSessionId?: string; sessionId?: string },
    ): Promise<HistoryMatch | null> => {
      if (!input || typeof input.tool !== 'string' || typeof input.projectPath !== 'string') return null
      const wantedId = typeof input.sessionId === 'string' ? input.sessionId.trim() : ''
      const toMatch = (parsed: ParsedSession, file: string): HistoryMatch => ({
        tool: input.tool,
        projectPath: parsed.projectPath,
        sessionFile: file,
        sessionId: parsed.nativeSessionId,
        title: parsed.title.trim().slice(0, 120) || path.basename(file, '.jsonl'),
        snippet: snippetFor(parsed.texts, ''),
        startedAt: parsed.startedAt,
        mtime: parsed.mtime,
      })
      const finish = async (match: HistoryMatch | null) => {
        if (!match) return null
        return overlayCodexTitle(match, await loadCodexThreadNames())
      }

      if (input.tool === 'opencode' || input.tool === 'antigravity') {
        const records = input.tool === 'opencode' ? await loadOpenCodeRecords(false) : await loadAntigravityRecords()
        if (wantedId) return records.find((record) => record.sessionId === wantedId) ?? null
        const candidates = records.filter((record) => matchesRecentNativeSession({
          nativeSessionId: record.sessionId,
          projectPath: record.projectPath,
          startedAt: record.startedAt,
          mtime: record.mtime,
        }, {
          projectPath: input.projectPath,
          startedAt: Number(input.startedAt || 0),
          excludeSessionId: input.excludeSessionId,
        }))
        candidates.sort((a, b) => b.mtime - a.mtime)
        return candidates[0] ?? null
      }
      const root = HISTORY_ROOTS.find((r) => r.id === input.tool)
      if (!root) return null
      if (wantedId) {
        const file = await resolveHistorySessionFile(input.tool, wantedId)
        if (!file || file.startsWith('opencode:') || file.startsWith('antigravity:')) return null
        const parsed = await parseSession(file, input.tool)
        return parsed ? finish(toMatch(parsed, file)) : null
      }
      const files = await walkJsonl(path.join(os.homedir(), root.rel))
      const candidates: HistoryMatch[] = []
      for (const file of files) {
        let st: import('node:fs').Stats
        try {
          st = await fsp.stat(file)
        } catch {
          continue
        }
        if (st.mtimeMs < Number(input.startedAt || 0) - 5_000) continue
        const parsed = await parseSession(file, input.tool)
        if (
          !parsed ||
          !matchesRecentNativeSession(parsed, {
            projectPath: input.projectPath,
            startedAt: Number(input.startedAt || 0),
            excludeSessionId: input.excludeSessionId,
          })
        ) continue
        candidates.push(toMatch(parsed, file))
      }
      candidates.sort((a, b) => b.mtime - a.mtime)
      return finish(candidates[0] ?? null)
    },
  )

  ipcMain.handle(
    'history:readSessionPage',
    async (_e, tool: string, sessionId: string, before?: number): Promise<HistoryFilePage | null> => {
      if (typeof tool !== 'string' || typeof sessionId !== 'string' || !sessionId) return null
      const file = await resolveHistorySessionFile(tool, sessionId)
      if (!file) return null
      const openCodeSessionId = sessionIdFromOpenCodeUri(file)
      const antigravityConversationId = conversationIdFromAntigravityUri(file)
      if (openCodeSessionId || antigravityConversationId) {
        const content = await readLatestHistoryPage(file)
        return content == null ? null : wholeTextPage(content)
      }
      try {
        return await readHistoryPage(file, before)
      } catch {
        return null
      }
    },
  )

  ipcMain.handle(
    'history:readFilePage',
    async (_e, file: string, before?: number): Promise<HistoryFilePage | null> => {
      if (!isAllowedHistoryFile(file)) return null
      if (sessionIdFromOpenCodeUri(file) || conversationIdFromAntigravityUri(file)) {
        const content = await readLatestHistoryPage(file)
        return content == null ? null : wholeTextPage(content)
      }
      try {
        return await readHistoryPage(file, before)
      } catch {
        return null
      }
    },
  )

  // 兼容旧调用：只返回最近一页；详情视图使用上面的分页接口读取完整历史。
  ipcMain.handle('history:readSession', async (_e, tool: string, sessionId: string): Promise<string | null> => {
    if (typeof tool !== 'string' || typeof sessionId !== 'string' || !sessionId) return null
    const file = await resolveHistorySessionFile(tool, sessionId)
    return file ? readLatestHistoryPage(file) : null
  })

  ipcMain.handle('history:readFile', async (_e, file: string): Promise<string | null> => {
    return isAllowedHistoryFile(file) ? readLatestHistoryPage(file) : null
  })
}
