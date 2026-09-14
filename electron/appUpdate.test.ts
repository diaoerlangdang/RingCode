import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  detectUpdateChannel,
  evaluateRelease,
  isNewerVersion,
  normalizeVersion,
  pickReleaseAsset,
} from './appUpdate'

const exe = { name: '金刚琢-0.4.1-x64.exe', browser_download_url: 'https://github.com/diaoerlangdang/RingCode/releases/download/v0.4.1/exe' }
const zip = { name: '金刚琢-0.4.1-x64.zip', browser_download_url: 'https://github.com/diaoerlangdang/RingCode/releases/download/v0.4.1/zip' }
const src = { name: 'Source code (zip)', browser_download_url: 'https://github.com/diaoerlangdang/RingCode/archive/refs/tags/v0.4.1.zip' }
const blockmap = { name: '金刚琢-0.4.1-x64.exe.blockmap', browser_download_url: 'https://example.com/blockmap' }

describe('normalizeVersion / compareVersions', () => {
  it('去掉 v 前缀并比较数字段', () => {
    expect(normalizeVersion('v0.4.1')).toBe('0.4.1')
    expect(compareVersions('0.4.0', 'v0.4.0')).toBe(0)
    expect(compareVersions('0.4.1', '0.4.0')).toBeGreaterThan(0)
    expect(compareVersions('0.9.0', '0.10.0')).toBeLessThan(0)
  })

  it('判断 latest 是否新于 current', () => {
    expect(isNewerVersion('0.4.1', '0.4.0')).toBe(true)
    expect(isNewerVersion('v0.4.0', '0.4.0')).toBe(false)
    expect(isNewerVersion('0.3.9', '0.4.0')).toBe(false)
  })
})

describe('detectUpdateChannel', () => {
  it('未打包（开发态）按免安装提示', () => {
    expect(
      detectUpdateChannel({
        packaged: false,
        execDir: 'C:\\Users\\x\\AppData\\Local\\Programs\\electron',
        uninstallerExists: false,
      }),
    ).toBe('portable')
  })

  it('有卸载程序或装在 Programs 下视为安装版', () => {
    expect(
      detectUpdateChannel({
        packaged: true,
        execDir: 'D:\\apps\\金刚琢',
        uninstallerExists: true,
      }),
    ).toBe('installer')
    expect(
      detectUpdateChannel({
        packaged: true,
        execDir: 'C:\\Users\\x\\AppData\\Local\\Programs\\金刚琢',
        uninstallerExists: false,
      }),
    ).toBe('installer')
    expect(
      detectUpdateChannel({
        packaged: true,
        execDir: 'C:\\Program Files\\金刚琢',
        uninstallerExists: false,
      }),
    ).toBe('installer')
  })

  it('解压目录没有卸载程序视为免安装版', () => {
    expect(
      detectUpdateChannel({
        packaged: true,
        execDir: 'D:\\tools\\金刚琢',
        uninstallerExists: false,
      }),
    ).toBe('portable')
  })
})

describe('pickReleaseAsset', () => {
  it('免安装选 zip，安装版选 exe，都忽略源码包和 blockmap', () => {
    const assets = [src, blockmap, exe, zip]
    expect(pickReleaseAsset(assets, 'portable')?.name).toBe(zip.name)
    expect(pickReleaseAsset(assets, 'installer')?.name).toBe(exe.name)
  })

  it('没有对应包装时返回空，让调用方回退到 Release 页', () => {
    expect(pickReleaseAsset([exe, src], 'portable')).toBeNull()
    expect(pickReleaseAsset([zip, src], 'installer')).toBeNull()
    expect(pickReleaseAsset([src], 'portable')).toBeNull()
  })
})

describe('evaluateRelease', () => {
  it('有更新时指向当前渠道的包装，没有包装则只给 Release 页', () => {
    const newer = evaluateRelease(
      { tag_name: 'v0.4.1', html_url: 'https://github.com/diaoerlangdang/RingCode/releases/tag/v0.4.1', assets: [exe, zip] },
      '0.4.0',
      'portable',
    )
    expect(newer.newer).toBe(true)
    expect(newer.latestVersion).toBe('0.4.1')
    expect(newer.downloadUrl).toBe(zip.browser_download_url)
    expect(newer.downloadName).toBe(zip.name)

    const noZip = evaluateRelease(
      { tag_name: 'v0.4.1', html_url: 'https://github.com/diaoerlangdang/RingCode/releases/tag/v0.4.1', assets: [exe] },
      '0.4.0',
      'portable',
    )
    expect(noZip.newer).toBe(true)
    expect(noZip.downloadUrl).toBeNull()
    expect(noZip.releaseUrl).toContain('/releases/tag/v0.4.1')
  })

  it('已是最新时 newer 为 false', () => {
    const same = evaluateRelease(
      { tag_name: 'v0.4.0', html_url: 'https://github.com/diaoerlangdang/RingCode/releases/tag/v0.4.0', assets: [zip] },
      '0.4.0',
      'portable',
    )
    expect(same.newer).toBe(false)
  })
})
