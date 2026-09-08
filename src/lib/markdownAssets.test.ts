import { describe, expect, it } from 'vitest'
import { resolveMarkdownAssetSegments } from './markdownAssets'

describe('resolveMarkdownAssetSegments', () => {
  const markdown = ['docs', 'guide', 'README.md']

  it('相对于 Markdown 所在目录解析 ./ 图片', () => {
    expect(resolveMarkdownAssetSegments(markdown, './images/demo.png')).toEqual([
      'docs',
      'guide',
      'images',
      'demo.png',
    ])
  })

  it('支持 ..、URL 编码以及查询参数', () => {
    expect(resolveMarkdownAssetSegments(markdown, '../assets/demo%20image.png?raw=1#preview')).toEqual([
      'docs',
      'assets',
      'demo image.png',
    ])
  })

  it('拒绝越过工作区根目录', () => {
    expect(resolveMarkdownAssetSegments(['README.md'], '../secret.png')).toBeNull()
  })

  it('不处理远程、data、锚点和根路径地址', () => {
    expect(resolveMarkdownAssetSegments(markdown, 'https://example.com/a.png')).toBeNull()
    expect(resolveMarkdownAssetSegments(markdown, 'data:image/png;base64,abc')).toBeNull()
    expect(resolveMarkdownAssetSegments(markdown, '#diagram')).toBeNull()
    expect(resolveMarkdownAssetSegments(markdown, '/assets/a.png')).toBeNull()
  })
})
