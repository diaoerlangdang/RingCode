/** GitHub Release 检查更新：按当前是免安装还是安装版，指向对应包装。不自动替换文件。 */

export const UPDATE_REPO = 'diaoerlangdang/RingCode'
export const UPDATE_RELEASES_URL = `https://github.com/${UPDATE_REPO}/releases`
export const UPDATE_API_URL = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`

export type UpdateChannel = 'portable' | 'installer'

export interface ReleaseAsset {
  name: string
  browser_download_url: string
}

export interface GithubRelease {
  tag_name: string
  html_url: string
  assets?: ReleaseAsset[]
}

export interface UpdateEval {
  latestVersion: string
  newer: boolean
  releaseUrl: string
  downloadUrl: string | null
  downloadName: string | null
}

export function normalizeVersion(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/^v/i, '')
    .split(/[-+]/)[0]
}

function versionParts(raw: string): number[] {
  return normalizeVersion(raw)
    .split('.')
    .map((n) => {
      const v = Number.parseInt(n, 10)
      return Number.isFinite(v) ? v : 0
    })
}

export function compareVersions(a: string, b: string): number {
  const left = versionParts(a)
  const right = versionParts(b)
  const len = Math.max(left.length, right.length)
  for (let i = 0; i < len; i++) {
    const d = (left[i] ?? 0) - (right[i] ?? 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0
}

export function detectUpdateChannel(input: {
  packaged: boolean
  execDir: string
  uninstallerExists: boolean
}): UpdateChannel {
  if (!input.packaged) return 'portable'
  if (input.uninstallerExists) return 'installer'
  const dir = input.execDir.replace(/\//g, '\\').toLowerCase()
  if (dir.includes('\\program files')) return 'installer'
  if (dir.includes('\\programs\\')) return 'installer'
  return 'portable'
}

function isIgnorableAsset(name: string): boolean {
  const n = name.toLowerCase()
  if (n.startsWith('source code')) return true
  if (n.endsWith('.blockmap')) return true
  if (n.endsWith('.yml') || n.endsWith('.yaml')) return true
  if (n.endsWith('.tar.gz')) return true
  return false
}

export function pickReleaseAsset(assets: ReleaseAsset[], channel: UpdateChannel): ReleaseAsset | null {
  const usable = assets.filter((a) => a?.name && a.browser_download_url && !isIgnorableAsset(a.name))
  if (channel === 'portable') {
    return usable.find((a) => a.name.toLowerCase().endsWith('.zip')) ?? null
  }
  return (
    usable.find((a) => {
      const n = a.name.toLowerCase()
      return n.endsWith('.exe') && !n.includes('portable')
    }) ?? null
  )
}

export function evaluateRelease(release: GithubRelease, currentVersion: string, channel: UpdateChannel): UpdateEval {
  const latestVersion = normalizeVersion(release.tag_name)
  const asset = pickReleaseAsset(release.assets ?? [], channel)
  return {
    latestVersion,
    newer: isNewerVersion(latestVersion, currentVersion),
    releaseUrl: release.html_url || UPDATE_RELEASES_URL,
    downloadUrl: asset?.browser_download_url ?? null,
    downloadName: asset?.name ?? null,
  }
}

export function channelLabel(channel: UpdateChannel): string {
  return channel === 'installer' ? '安装版' : '免安装版'
}

export interface UpdateCheckResult {
  ok: boolean
  currentVersion: string
  channel: UpdateChannel
  packaged: boolean
  latestVersion: string | null
  newer: boolean
  releaseUrl: string
  downloadUrl: string | null
  downloadName: string | null
  message: string
}

export function buildUpdateMessage(result: Omit<UpdateCheckResult, 'ok' | 'message'> & { error?: string }): string {
  if (result.error) return result.error
  const kind = channelLabel(result.channel)
  if (!result.latestVersion) return `未能读取 GitHub Release（当前 ${result.currentVersion}，${kind}）`
  if (!result.newer) return `已是最新版本 ${result.currentVersion}（${kind}）`
  if (result.downloadName) return `发现新版本 ${result.latestVersion}，将下载${kind}「${result.downloadName}」`
  return `发现新版本 ${result.latestVersion}。Release 上还没有对应的${kind}包装，将打开发布页`
}
