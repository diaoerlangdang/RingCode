// 金刚琢 Electron 主进程
// 负责：创建窗口、加载渲染层（dev: Vite 服务器 / prod: dist）、受控 IPC。
// 安全：contextIsolation 开启，渲染层不直接获得 Node 权限（§9.1/9.2）。

import { app, BrowserWindow, ipcMain, dialog, shell, Menu, Notification } from 'electron'
import * as path from 'node:path'
import { promises as fsp } from 'node:fs'
import { registerPtyHandlers, disposeAllPty } from './pty'
import { registerCredHandlers } from './cred'
import { registerDbHandlers } from './db'
import { registerEnvHandlers } from './env'
import { registerGitHandlers } from './git'
import { registerSkillHandlers } from './skills'
import { registerSearchHandlers } from './search'
import { registerHistoryHandlers } from './history'
import { registerWatchHandlers, disposeWatcher } from './watch'
import { registerOwnedResourceHandlers } from './ownedResources'
import { registerCodexOverlayHandlers } from './codexOverlayWrite'
import { registerCloneResourceHandlers } from './cloneResources'
import { registerCloneModelHandlers } from './cloneModels'
import { registerAppUpdateHandlers } from './appUpdateIpc'
import { writeAppLaunchPointer, type AppLaunchPointer } from './cloneLauncherFile'
import { addAllowedRoot, isSelfOrInside, isUnderAllowedRoot, resolveSafe, setAllowedRoots } from './pathSafe'
import { isAllowedExternalUrl } from './urlSafe'

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const isDev = !!DEV_SERVER_URL

if (process.env.RINGCODE_USER_DATA_DIR) {
  app.setPath('userData', process.env.RINGCODE_USER_DATA_DIR)
}

function currentAppLaunchPointer(): AppLaunchPointer {
  return {
    exe: process.execPath,
    script: path.join(app.getAppPath(), 'electron-dist', 'cloneLaunchCli.js'),
  }
}

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 860,
    minWidth: 1024,
    minHeight: 600,
    backgroundColor: '#0e1216',
    title: '金刚琢',
    icon: isDev ? path.join(__dirname, '..', 'build', 'icon.ico') : undefined,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload 需要 limited Node 访问以桥接 IPC
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())



  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL!)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  // 外部链接在系统浏览器打开（§9.6）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
}

/* ---------------- IPC：受控文件 / Shell / 凭据接口 ---------------- */

// 打开文件夹选择器（renderer 也可直接用 FS Access API；此为原生备选）
ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  addAllowedRoot(result.filePaths[0])
  return result.filePaths[0]
})

// 在资源管理器中定位（FIL-005）
ipcMain.handle('shell:revealInExplorer', async (_e, p: string) => {
  if (typeof p !== 'string') throw new Error('invalid path')
  if (!isUnderAllowedRoot(p)) throw new Error('路径未登记为工作区')
  shell.showItemInFolder(p)
})

// 保存文件对话框 + 写文件（HIS-013 会话导出等）
ipcMain.handle('dialog:saveText', async (_e, defaultName: string, content: string) => {
  if (typeof defaultName !== 'string' || typeof content !== 'string') throw new Error('invalid args')
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: defaultName,
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'Text', extensions: ['txt'] },
      { name: 'All', extensions: ['*'] },
    ],
  })
  if (result.canceled || !result.filePath) return null
  await fsp.writeFile(result.filePath, content, 'utf8')
  return result.filePath
})

// 系统通知（TRM-008：命令结束/失败时通知）
ipcMain.handle('notify:show', (_e, title: string, body: string) => {
  if (typeof title !== 'string' || typeof body !== 'string') return
  if (!Notification.isSupported()) return
  try {
    new Notification({ title, body, silent: false }).show()
  } catch {
    /* 通知失败不影响主流程 */
  }
})

// 打开文件对话框 + 读文本（CFG-007 配置导入等）
ipcMain.handle('dialog:openText', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    filters: [
      { name: 'JSON', extensions: ['json'] },
      { name: 'All', extensions: ['*'] },
    ],
    properties: ['openFile'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const content = await fsp.readFile(result.filePaths[0], 'utf8')
  return { name: path.basename(result.filePaths[0]), content }
})

// 凭据：见 electron/cred.ts（Windows Credential Manager，@napi-rs/keyring）

/* ---------------- IPC：真实文件系统（Node fs，§9.3 路径校验） ---------------- */

ipcMain.handle('workspace:setRoots', (_e, roots: string[]) => {
  if (!Array.isArray(roots)) throw new Error('invalid roots')
  setAllowedRoots(roots.filter((r) => typeof r === 'string'))
})

ipcMain.handle('fs:list', async (_e, rootPath: string, segments: string[]) => {
  const dir = resolveSafe(rootPath, segments ?? [])
  const out: { name: string; isDir: boolean; size?: number; modified?: number }[] = []
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    let size: number | undefined
    let modified: number | undefined
    try {
      const st = await fsp.stat(path.join(dir, entry.name))
      if (entry.isFile()) size = st.size
      modified = st.mtimeMs
    } catch {
      /* 忽略个别 stat 失败 */
    }
    out.push({ name: entry.name, isDir: entry.isDirectory(), size, modified })
  }
  out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  return out
})

ipcMain.handle('fs:readText', async (_e, rootPath: string, segments: string[]) => {
  const file = resolveSafe(rootPath, segments ?? [])
  try {
    return await fsp.readFile(file, 'utf8')
  } catch (e) {
    // 文件不存在时返回 null（与渲染层 readTextFile 契约一致），避免 ENOENT 噪声
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
})

/** 图片/PDF 预览用 data URL（EDT-004/EDT-006）。二进制读取，base64 编码。 */
function mimeFor(name: string): string {
  const n = name.toLowerCase()
  if (n.endsWith('.png')) return 'image/png'
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg'
  if (n.endsWith('.gif')) return 'image/gif'
  if (n.endsWith('.webp')) return 'image/webp'
  if (n.endsWith('.svg')) return 'image/svg+xml'
  if (n.endsWith('.bmp')) return 'image/bmp'
  if (n.endsWith('.pdf')) return 'application/pdf'
  return 'application/octet-stream'
}

ipcMain.handle('fs:readDataUrl', async (_e, rootPath: string, segments: string[]) => {
  const file = resolveSafe(rootPath, segments ?? [])
  try {
    const buf = await fsp.readFile(file)
    if (buf.length > 10 * 1024 * 1024) throw new Error('文件过大，不支持预览（>10MB）')
    return `data:${mimeFor(path.basename(file))};base64,${buf.toString('base64')}`
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
})

ipcMain.handle('fs:writeText', async (_e, rootPath: string, segments: string[], content: string) => {
  const file = resolveSafe(rootPath, segments ?? [])
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, content, 'utf8')
})

ipcMain.handle('fs:mkdir', async (_e, rootPath: string, segments: string[]) => {
  const dir = resolveSafe(rootPath, segments ?? [])
  await fsp.mkdir(dir, { recursive: false })
})

ipcMain.handle('fs:rename', async (_e, rootPath: string, segments: string[], newName: string) => {
  if (typeof newName !== 'string' || /[\\/]/.test(newName) || newName === '.' || newName === '..') {
    throw new Error('非法名称')
  }
  const oldPath = resolveSafe(rootPath, segments ?? [])
  const newPath = resolveSafe(rootPath, [...(segments ?? []).slice(0, -1), newName])
  await fsp.rename(oldPath, newPath)
})

ipcMain.handle('fs:delete', async (_e, rootPath: string, segments: string[]) => {
  const target = resolveSafe(rootPath, segments ?? [])
  await shell.trashItem(target)
})

ipcMain.handle('fs:stat', async (_e, rootPath: string, segments: string[]) => {
  const file = resolveSafe(rootPath, segments ?? [])
  try {
    const st = await fsp.stat(file)
    return { mtime: st.mtimeMs, size: st.size, isDir: st.isDirectory() }
  } catch {
    return null
  }
})

ipcMain.handle('fs:copy', async (_e, rootPath: string, segments: string[], destName: string) => {
  if (typeof destName !== 'string' || /[\\/]/.test(destName) || destName === '.' || destName === '..') {
    throw new Error('非法名称')
  }
  const src = resolveSafe(rootPath, segments ?? [])
  const dest = resolveSafe(rootPath, [...(segments ?? []).slice(0, -1), destName])
  await fsp.copyFile(src, dest)
})

async function pathExists(file: string): Promise<boolean> {
  try {
    await fsp.stat(file)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

/** 复制文件/文件夹（递归）到目标目录（destSegments 为目标完整路径，含名称）。源/目标可跨已登记根。 */
ipcMain.handle(
  'fs:copyTo',
  async (_e, rootPath: string, srcSegments: string[], destRootPath: string, destSegments: string[]) => {
    const src = resolveSafe(rootPath, srcSegments ?? [])
    const dest = resolveSafe(destRootPath ?? rootPath, destSegments ?? [])
    if (isSelfOrInside(dest, src)) throw new Error('不能复制到自身或其子目录内')
    if (await pathExists(dest)) throw new Error('目标已存在')
    await fsp.cp(src, dest, { recursive: true, errorOnExist: true })
  },
)

/** 移动（剪切粘贴）文件/文件夹到目标目录。同盘用 rename，跨盘回退为递归复制后删源。 */
ipcMain.handle(
  'fs:moveTo',
  async (_e, rootPath: string, srcSegments: string[], destRootPath: string, destSegments: string[]) => {
    const src = resolveSafe(rootPath, srcSegments ?? [])
    const dest = resolveSafe(destRootPath ?? rootPath, destSegments ?? [])
    if (isSelfOrInside(dest, src)) throw new Error('不能移动到自身或其子目录内')
    if (await pathExists(dest)) throw new Error('目标已存在')
    try {
      await fsp.rename(src, dest)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
      await fsp.cp(src, dest, { recursive: true, errorOnExist: true })
      try {
        await fsp.stat(dest)
      } catch {
        throw new Error('跨盘移动失败：目标未完整写入，已保留源文件')
      }
      try {
        await fsp.rm(src, { recursive: true, force: true })
      } catch (err) {
        throw new Error(`已复制到目标，但未能删除源：${err instanceof Error ? err.message : String(err)}`)
      }
    }
  },
)

ipcMain.handle('dialog:openExe', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: 'Executable', extensions: ['exe', 'cmd', 'bat'] },
      { name: 'All', extensions: ['*'] },
    ],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

// 列出本机可用磁盘根目录（FIL-005 左侧「此电脑」）。Windows 探测 C:-Z:，其他平台返回根。
ipcMain.handle('fs:listDrives', async (): Promise<string[]> => {
  if (process.platform === 'win32') {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
    const results = await Promise.all(
      letters.map(async (L) => {
        const root = `${L}:\\`
        try {
          await fsp.access(root)
          return root
        } catch {
          return null
        }
      }),
    )
    return results.filter((x): x is string => !!x)
  }
  return ['/']
})

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    // 无菜单栏（快捷键由渲染层管理）
    Menu.setApplicationMenu(null)
    // Windows 通知需要 AppUserModelId 才能正常弹出（TRM-008）
    if (process.platform === 'win32') app.setAppUserModelId('com.ringcode.app')
    registerPtyHandlers()
    registerCredHandlers()
    registerOwnedResourceHandlers()
    registerCodexOverlayHandlers()
    registerCloneResourceHandlers(currentAppLaunchPointer)
    registerCloneModelHandlers()
    writeAppLaunchPointer(currentAppLaunchPointer())
    registerDbHandlers()
    registerEnvHandlers()
    registerGitHandlers()
    registerSkillHandlers()
    registerSearchHandlers()
    registerHistoryHandlers()
    registerWatchHandlers()
    registerAppUpdateHandlers()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

// 退出前清理所有 PTY 子进程，避免孤儿进程
app.on('before-quit', () => {
  disposeAllPty()
  disposeWatcher()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
