import { app, ipcMain, clipboard, nativeImage, dialog, BrowserWindow } from 'electron'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { AttachmentCache, imageExtension, imageReferences, MAX_IMAGE_BYTES } from './attachmentCache'
import { readStoredValue } from './db'

export function registerAttachmentHandlers(): void {
  const cache = new AttachmentCache(path.join(app.getPath('userData'), 'attachments'))
  const refs = () => imageReferences(readStoredValue('ringcode-store'))
  const add = (name: string, bytes: Uint8Array) => {
    imageExtension(bytes)
    if (nativeImage.createFromBuffer(Buffer.from(bytes)).isEmpty()) throw new Error('图片损坏或无法解码')
    return cache.add(name, bytes)
  }
  ipcMain.handle('attachment:add', (_event, name: string, bytes: Uint8Array) => {
    if (typeof name !== 'string' || !(bytes instanceof Uint8Array)) throw new Error('无效图片')
    return add(name, bytes)
  })
  ipcMain.handle('attachment:clipboard', () => {
    const image = clipboard.readImage()
    return image.isEmpty() ? null : add('截图.png', image.toPNG())
  })
  ipcMain.handle('attachment:choose', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const opts: Electron.OpenDialogOptions = { properties: ['openFile', 'multiSelections'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg'] }] }
    const result = window ? await dialog.showOpenDialog(window, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled) return []
    const images = []
    try {
      for (const file of result.filePaths) {
        if (fs.statSync(file).size > MAX_IMAGE_BYTES) throw new Error('每张图片最大 10 MB')
        images.push(add(path.basename(file), fs.readFileSync(file)))
      }
      return images
    } catch (error) {
      cache.clean(refs(), images.map((image) => image.id))
      throw error
    }
  })
  ipcMain.handle('attachment:read', (_event, id: string) => {
    const { bytes, path: file } = cache.read(id)
    const ext = imageExtension(bytes)
    return { path: file, dataUrl: `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${bytes.toString('base64')}` }
  })
  ipcMain.handle('attachment:stats', () => cache.stats(refs()))
  ipcMain.handle('attachment:clean', (_event, ids?: string[]) => {
    if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string'))) throw new Error('无效图片标识')
    return cache.clean(refs(), ids)
  })
  try { cache.clean(refs()) } catch (error) { console.warn('图片缓存清理暂停：', String(error)) }
}
