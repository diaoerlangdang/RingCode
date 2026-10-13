import { flushStorageWrites } from './sqliteStorage'

export interface ImageAttachment { id: string; name: string; path: string; size: number }
export interface TerminalDraft { text: string; images: ImageAttachment[] }
export const emptyTerminalDraft: TerminalDraft = { text: '', images: [] }

export async function cleanUnusedImages(ids?: string[]): Promise<void> {
  if (!window.ringcode?.attachmentClean) return
  await flushStorageWrites()
  const result = await window.ringcode.attachmentClean(ids)
  if (result.failed) throw new Error(`${result.failed} 个图片缓存删除失败，后续清理会重试`)
}

export async function importImageFiles(files: File[]): Promise<ImageAttachment[]> {
  const api = window.ringcode
  if (!api?.attachmentAdd) throw new Error('图片附件需要桌面环境')
  const results: ImageAttachment[] = []
  try {
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) throw new Error('每张图片最大 10 MB')
      results.push(await api.attachmentAdd(file.name, new Uint8Array(await file.arrayBuffer())))
    }
    return results
  } catch (error) {
    await cleanUnusedImages(results.map((image) => image.id)).catch(() => {})
    throw error
  }
}
