import { app, ipcMain, net, shell, type WebContents } from 'electron'
import { existsSync } from 'node:fs'
import * as path from 'node:path'
import {
  UPDATE_API_URL,
  UPDATE_RELEASES_URL,
  buildUpdateMessage,
  detectUpdateChannel,
  evaluateRelease,
  type GithubRelease,
  type ReleaseAsset,
  type UpdateCheckResult,
} from './appUpdate'
import { downloadUpdateInstaller, type UpdateDownloadProgress } from './appUpdateDownload'

const CACHE_MS = 10 * 60 * 1000
let cache: { at: number; result: UpdateCheckResult } | null = null
let activeDownload: Promise<{ ok: boolean; error?: string }> | null = null

function uninstallerExists(execDir: string): boolean {
  return ['Uninstall 金刚琢.exe', 'uninstall.exe'].some((name) => existsSync(path.join(execDir, name)))
}

export function currentUpdateRuntime() {
  const execDir = path.dirname(process.execPath)
  return {
    currentVersion: app.getVersion(),
    channel: detectUpdateChannel({
      packaged: app.isPackaged,
      execDir,
      uninstallerExists: uninstallerExists(execDir),
    }),
    packaged: app.isPackaged,
  }
}

function parseGithubRelease(raw: unknown): GithubRelease | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.tag_name !== 'string' || !o.tag_name.trim()) return null
  const assets: ReleaseAsset[] = []
  if (Array.isArray(o.assets)) {
    for (const item of o.assets) {
      if (!item || typeof item !== 'object') continue
      const a = item as Record<string, unknown>
      if (typeof a.name === 'string' && typeof a.browser_download_url === 'string') {
        assets.push({
          name: a.name,
          browser_download_url: a.browser_download_url,
          size: typeof a.size === 'number' && a.size > 0 ? a.size : undefined,
        })
      }
    }
  }
  return {
    tag_name: o.tag_name,
    html_url: typeof o.html_url === 'string' ? o.html_url : UPDATE_RELEASES_URL,
    name: typeof o.name === 'string' ? o.name : undefined,
    body: typeof o.body === 'string' ? o.body : undefined,
    published_at: typeof o.published_at === 'string' ? o.published_at : undefined,
    assets,
  }
}

function failResult(runtime: ReturnType<typeof currentUpdateRuntime>, error: string): UpdateCheckResult {
  return {
    ok: false,
    ...runtime,
    latestVersion: null,
    newer: false,
    releaseUrl: UPDATE_RELEASES_URL,
    downloadUrl: null,
    downloadName: null,
    downloadSize: null,
    releaseName: null,
    releaseNotes: null,
    publishedAt: null,
    message: buildUpdateMessage({
      ...runtime,
      latestVersion: null,
      newer: false,
      releaseUrl: UPDATE_RELEASES_URL,
      downloadUrl: null,
      downloadName: null,
      downloadSize: null,
      releaseName: null,
      releaseNotes: null,
      publishedAt: null,
      error,
    }),
  }
}

function emitUpdateProgress(sender: WebContents, payload: {
  phase: 'downloading' | 'installing' | 'error'
  version: string
  message: string
  receivedBytes?: number
  totalBytes?: number | null
  percent?: number
}) {
  if (!sender.isDestroyed()) sender.send('update:progress', payload)
}

function progressMessage(progress: UpdateDownloadProgress): string {
  if (!progress.totalBytes) return `正在下载更新（${Math.round(progress.receivedBytes / 1024 / 1024)} MB）`
  return '正在下载更新…'
}

async function downloadAndInstallUpdate(sender: WebContents): Promise<{ ok: boolean; error?: string }> {
  const update = await checkForAppUpdate(false)
  if (!update.ok || !update.newer || !update.latestVersion) return { ok: false, error: '当前没有可安装的新版本' }
  if (!update.downloadUrl || !update.downloadName?.toLowerCase().endsWith('.exe')) {
    return { ok: false, error: '当前 Release 暂未提供 Windows 安装包' }
  }

  try {
    const installer = await downloadUpdateInstaller({
      url: update.downloadUrl,
      version: update.latestVersion,
      expectedSize: update.downloadSize,
      destinationDir: path.join(app.getPath('temp'), 'RingCode-updates'),
      fetcher: (url) =>
        net.fetch(url, {
          redirect: 'follow',
          headers: { 'User-Agent': 'RingCode' },
        }),
      onProgress: (progress) =>
        emitUpdateProgress(sender, {
          phase: 'downloading',
          version: update.latestVersion!,
          message: progressMessage(progress),
          ...progress,
        }),
    })
    emitUpdateProgress(sender, {
      phase: 'installing',
      version: update.latestVersion,
      message: '下载完成，正在启动安装程序…',
      percent: 100,
    })
    const openError = await shell.openPath(installer)
    if (openError) throw new Error(`无法启动安装程序：${openError}`)
    setTimeout(() => app.quit(), 600)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : '下载安装失败，请重试'
    emitUpdateProgress(sender, { phase: 'error', version: update.latestVersion, message })
    return { ok: false, error: message }
  }
}

export async function checkForAppUpdate(force = false): Promise<UpdateCheckResult> {
  const runtime = currentUpdateRuntime()
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.result
  try {
    const res = await fetch(UPDATE_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'RingCode',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (res.status === 404) return failResult(runtime, '还没有 GitHub Release，发布后即可检查更新')
    if (!res.ok) return failResult(runtime, `检查更新失败（HTTP ${res.status}）`)
    const parsed = parseGithubRelease(await res.json())
    if (!parsed) return failResult(runtime, 'GitHub 返回的 Release 数据无法解析')
    const ev = evaluateRelease(parsed, runtime.currentVersion, runtime.channel)
    const result: UpdateCheckResult = {
      ok: true,
      ...runtime,
      ...ev,
      message: buildUpdateMessage({ ...runtime, ...ev }),
    }
    cache = { at: Date.now(), result }
    return result
  } catch {
    return failResult(runtime, '检查更新失败：网络不可用或无法访问 GitHub')
  }
}

export function registerAppUpdateHandlers() {
  ipcMain.handle('update:runtime', () => currentUpdateRuntime())
  ipcMain.handle('update:check', (_e, force?: unknown) => checkForAppUpdate(force === true))
  ipcMain.handle('update:install', (event) => {
    if (!activeDownload) {
      activeDownload = downloadAndInstallUpdate(event.sender).finally(() => {
        activeDownload = null
      })
    }
    return activeDownload
  })
}
