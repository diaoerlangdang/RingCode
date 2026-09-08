import { ipcMain, BrowserWindow } from 'electron'
import * as fs from 'node:fs'
import { resolveSafe } from './pathSafe'

let watcher: fs.FSWatcher | null = null
let watchRoot = ''

function getWin(): BrowserWindow | null {
  const wins = BrowserWindow.getAllWindows()
  return wins.length ? wins[0] : null
}

let debounce: ReturnType<typeof setTimeout> | null = null
const pending = new Map<string, { event: string; filename: string; rootPath: string }>()

function isDriveRoot(p: string): boolean {
  return /^[a-zA-Z]:[\\/]?$/.test(p.trim())
}

export function registerWatchHandlers(): void {
  ipcMain.handle('fs:watch', (_e, rootPath: string) => {
    if (typeof rootPath !== 'string' || !rootPath) throw new Error('invalid root')
    resolveSafe(rootPath, [])
    if (isDriveRoot(rootPath)) return false
    if (watcher && watchRoot.toLowerCase() === rootPath.toLowerCase()) return true
    try {
      watcher?.close()
    } catch {
      /* ignore */
    }
    if (debounce) clearTimeout(debounce)
    debounce = null
    pending.clear()
    watchRoot = rootPath
    try {
      watcher = fs.watch(rootPath, { recursive: true }, (event, filename) => {
        const name = filename ? String(filename) : ''
        pending.set(name.toLowerCase(), { event, filename: name, rootPath })
        if (debounce) return
        debounce = setTimeout(() => {
          debounce = null
          const win = getWin()
          const payloads = [...pending.values()]
          pending.clear()
          if (!win || win.isDestroyed()) return
          for (const payload of payloads) win.webContents.send('fs:changed', payload)
        }, 400)
      })
      watcher.on('error', () => {
        try {
          watcher?.close()
        } catch {
          /* ignore */
        }
        watcher = null
        pending.clear()
        if (debounce) clearTimeout(debounce)
        debounce = null
      })
    } catch {
      watcher = null
      return false
    }
    return true
  })

  ipcMain.handle('fs:unwatch', () => {
    try {
      watcher?.close()
    } catch {
      /* ignore */
    }
    watcher = null
    watchRoot = ''
    pending.clear()
    if (debounce) clearTimeout(debounce)
    debounce = null
  })
}

export function disposeWatcher(): void {
  try {
    watcher?.close()
  } catch {
    /* ignore */
  }
  watcher = null
  pending.clear()
  if (debounce) clearTimeout(debounce)
  debounce = null
}
