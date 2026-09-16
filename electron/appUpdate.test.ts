import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  detectUpdateChannel,
  evaluateRelease,
  isNewerVersion,
  normalizeVersion,
  pickReleaseAsset,
} from './appUpdate'

const exe = { name: 'RingCode-0.4.2-x64.exe', browser_download_url: 'https://github.com/diaoerlangdang/RingCode/releases/download/v0.4.2/RingCode-0.4.2-x64.exe', size: 123 }
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
  it('安装版和免安装版都选择 NSIS 安装包，应用内升级不下载 ZIP', () => {
    const assets = [src, blockmap, exe, zip]
    expect(pickReleaseAsset(assets)?.name).toBe(exe.name)
  })

  it('没有安装包时返回空，不回退到浏览器或 ZIP', () => {
    expect(pickReleaseAsset([zip, src])).toBeNull()
    expect(pickReleaseAsset([src])).toBeNull()
  })
})

describe('evaluateRelease', () => {
  it('返回安装包和 Release Notes，没有安装包时保留说明但不提供下载地址', () => {
    const newer = evaluateRelease(
      {
        tag_name: 'v0.4.2',
        name: 'RingCode 0.4.2',
        body: '- 修复模型串线\n- 支持应用内升级',
        published_at: '2026-09-15T08:00:00Z',
        html_url: 'https://github.com/diaoerlangdang/RingCode/releases/tag/v0.4.2',
        assets: [exe, zip],
      },
      '0.4.1',
      'portable',
    )
    expect(newer.newer).toBe(true)
    expect(newer.latestVersion).toBe('0.4.2')
    expect(newer.downloadUrl).toBe(exe.browser_download_url)
    expect(newer.downloadName).toBe(exe.name)
    expect(newer.downloadSize).toBe(123)
    expect(newer.releaseName).toBe('RingCode 0.4.2')
    expect(newer.releaseNotes).toContain('模型串线')
    expect(newer.publishedAt).toBe('2026-09-15T08:00:00Z')

    const noInstaller = evaluateRelease(
      { tag_name: 'v0.4.2', html_url: 'https://github.com/diaoerlangdang/RingCode/releases/tag/v0.4.2', assets: [zip] },
      '0.4.1',
      'portable',
    )
    expect(noInstaller.newer).toBe(true)
    expect(noInstaller.downloadUrl).toBeNull()
    expect(noInstaller.releaseNotes).toBe('本次发布未填写更新说明。')
    expect(noInstaller.releaseUrl).toContain('/releases/tag/v0.4.2')
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
