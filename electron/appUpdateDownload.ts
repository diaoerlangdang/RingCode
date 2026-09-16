import { mkdir, open, rename, rm } from 'node:fs/promises'
import * as path from 'node:path'

const MAX_UPDATE_BYTES = 1024 * 1024 * 1024
const TRUSTED_DOWNLOAD_PREFIX = '/diaoerlangdang/RingCode/releases/download/'

interface DownloadResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  body: ReadableStream<Uint8Array> | null
}

export type UpdateFetcher = (url: string) => Promise<DownloadResponse>

export interface UpdateDownloadProgress {
  receivedBytes: number
  totalBytes: number | null
  percent: number
}

export function isTrustedUpdateDownloadUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return (
      url.protocol === 'https:' &&
      url.hostname.toLowerCase() === 'github.com' &&
      url.pathname.startsWith(TRUSTED_DOWNLOAD_PREFIX) &&
      url.pathname.toLowerCase().endsWith('.exe')
    )
  } catch {
    return false
  }
}

export function updateInstallerFileName(version: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('无效的更新版本号')
  return `RingCode-${version}-x64.exe`
}

export async function downloadUpdateInstaller(input: {
  url: string
  version: string
  expectedSize?: number | null
  destinationDir: string
  fetcher: UpdateFetcher
  onProgress?: (progress: UpdateDownloadProgress) => void
}): Promise<string> {
  if (!isTrustedUpdateDownloadUrl(input.url)) throw new Error('更新包地址不可信')
  if (input.expectedSize && input.expectedSize > MAX_UPDATE_BYTES) throw new Error('更新包大小异常')

  const fileName = updateInstallerFileName(input.version)
  const destination = path.join(input.destinationDir, fileName)
  const partial = `${destination}.download`
  await mkdir(input.destinationDir, { recursive: true })
  await rm(partial, { force: true })
  await rm(destination, { force: true })

  const response = await input.fetcher(input.url)
  if (!response.ok || !response.body) throw new Error(`下载安装包失败（HTTP ${response.status}）`)
  const headerSize = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  const totalBytes = input.expectedSize || (Number.isFinite(headerSize) && headerSize > 0 ? headerSize : null)
  if (totalBytes && totalBytes > MAX_UPDATE_BYTES) throw new Error('更新包大小异常')

  const handle = await open(partial, 'w')
  const reader = response.body.getReader()
  let receivedBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      receivedBytes += value.byteLength
      if (receivedBytes > MAX_UPDATE_BYTES) throw new Error('更新包大小异常')
      await handle.write(value)
      input.onProgress?.({
        receivedBytes,
        totalBytes,
        percent: totalBytes ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : 0,
      })
    }
  } catch (error) {
    await handle.close()
    await rm(partial, { force: true })
    throw error
  }
  await handle.close()

  if (totalBytes && receivedBytes !== totalBytes) {
    await rm(partial, { force: true })
    throw new Error('下载文件大小不完整，请重试')
  }
  await rename(partial, destination)
  return destination
}
