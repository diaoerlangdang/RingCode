import { app, ipcMain, shell } from 'electron'
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
import { isAllowedExternalUrl } from './urlSafe'

const CACHE_MS = 10 * 60 * 1000
let cache: { at: number; result: UpdateCheckResult } | null = null

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
        assets.push({ name: a.name, browser_download_url: a.browser_download_url })
      }
    }
  }
  return {
    tag_name: o.tag_name,
    html_url: typeof o.html_url === 'string' ? o.html_url : UPDATE_RELEASES_URL,
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
    message: buildUpdateMessage({ ...runtime, latestVersion: null, newer: false, releaseUrl: UPDATE_RELEASES_URL, downloadUrl: null, downloadName: null, error }),
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
  ipcMain.handle('update:open', async (_e, url: unknown) => {
    if (typeof url !== 'string' || !isAllowedExternalUrl(url)) return false
    await shell.openExternal(url)
    return true
  })
}
