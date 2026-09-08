import { promises as fsp } from 'node:fs'

export interface HistoryFilePage {
  content: string
  start: number
  end: number
  hasMore: boolean
}

const DEFAULT_PAGE_BYTES = 1024 * 1024
const SCAN_BLOCK_BYTES = 64 * 1024

async function findPreviousLineStart(handle: fsp.FileHandle, before: number): Promise<number> {
  let end = before
  while (end > 0) {
    const start = Math.max(0, end - SCAN_BLOCK_BYTES)
    const buffer = Buffer.allocUnsafe(end - start)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
    const newline = buffer.subarray(0, bytesRead).lastIndexOf(0x0a)
    if (newline >= 0) return start + newline + 1
    end = start
  }
  return 0
}

/** 从后向前读取完整 JSONL 行；反复传入上一页 start 可一直读取到文件开头。 */
export async function readHistoryPage(
  file: string,
  before?: number,
  maxBytes = DEFAULT_PAGE_BYTES,
): Promise<HistoryFilePage> {
  const st = await fsp.stat(file)
  const end = Math.min(st.size, Math.max(0, Number.isFinite(before) ? Math.floor(before!) : st.size))
  if (end === 0) return { content: '', start: 0, end: 0, hasMore: false }

  const pageBytes = Math.max(1, Math.floor(maxBytes))
  const candidate = Math.max(0, end - pageBytes)
  const handle = await fsp.open(file, 'r')
  try {
    let start = candidate
    if (candidate > 0) {
      const probe = Buffer.allocUnsafe(end - candidate)
      const { bytesRead } = await handle.read(probe, 0, probe.length, candidate)
      const newline = probe.subarray(0, bytesRead).indexOf(0x0a)
      if (newline >= 0 && newline < bytesRead - 1) {
        start = candidate + newline + 1
      } else {
        start = await findPreviousLineStart(handle, candidate)
      }
    }

    const buffer = Buffer.allocUnsafe(end - start)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
    return {
      content: buffer.subarray(0, bytesRead).toString('utf8'),
      start,
      end,
      hasMore: start > 0,
    }
  } finally {
    await handle.close()
  }
}
