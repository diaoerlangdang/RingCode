import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  downloadUpdateInstaller,
  isTrustedUpdateDownloadUrl,
  updateInstallerFileName,
} from './appUpdateDownload'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('isTrustedUpdateDownloadUrl', () => {
  it('只接受当前仓库 Release 下的 HTTPS 安装包', () => {
    expect(
      isTrustedUpdateDownloadUrl(
        'https://github.com/diaoerlangdang/RingCode/releases/download/v0.4.2/RingCode-0.4.2-x64.exe',
      ),
    ).toBe(true)
    expect(isTrustedUpdateDownloadUrl('http://github.com/diaoerlangdang/RingCode/releases/download/v0.4.2/a.exe')).toBe(false)
    expect(isTrustedUpdateDownloadUrl('https://github.com/other/RingCode/releases/download/v0.4.2/a.exe')).toBe(false)
    expect(isTrustedUpdateDownloadUrl('https://example.com/RingCode-0.4.2-x64.exe')).toBe(false)
    expect(isTrustedUpdateDownloadUrl('https://github.com/diaoerlangdang/RingCode/releases/download/v0.4.2/a.zip')).toBe(false)
  })
})

describe('updateInstallerFileName', () => {
  it('只把规范数字版本写入本地文件名', () => {
    expect(updateInstallerFileName('0.4.2')).toBe('RingCode-0.4.2-x64.exe')
    expect(() => updateInstallerFileName('../../bad')).toThrow('无效的更新版本号')
  })
})

describe('downloadUpdateInstaller', () => {
  it('流式写入安装包并报告进度', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ringcode-update-test-'))
    tempDirs.push(dir)
    const progress: number[] = []
    const result = await downloadUpdateInstaller({
      url: 'https://github.com/diaoerlangdang/RingCode/releases/download/v0.4.2/RingCode-0.4.2-x64.exe',
      version: '0.4.2',
      expectedSize: 4,
      destinationDir: dir,
      fetcher: async () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-length': '4' } }),
      onProgress: (value) => progress.push(value.percent),
    })

    expect(await readFile(result)).toEqual(Buffer.from([1, 2, 3, 4]))
    expect(progress.at(-1)).toBe(100)
  })

  it('响应大小不符时删除半成品并拒绝安装', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ringcode-update-test-'))
    tempDirs.push(dir)
    await expect(
      downloadUpdateInstaller({
        url: 'https://github.com/diaoerlangdang/RingCode/releases/download/v0.4.2/RingCode-0.4.2-x64.exe',
        version: '0.4.2',
        expectedSize: 5,
        destinationDir: dir,
        fetcher: async () => new Response(new Uint8Array([1, 2, 3, 4])),
      }),
    ).rejects.toThrow('下载文件大小不完整')
  })
})
