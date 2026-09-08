const NON_LOCAL_SRC = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|[\\/])/i

/** 将 Markdown 图片地址解析为工作区根目录下的安全路径；非本地相对地址返回 null。 */
export function resolveMarkdownAssetSegments(markdownSegments: string[], src: string): string[] | null {
  const raw = src.trim()
  if (!raw || NON_LOCAL_SRC.test(raw)) return null

  const pathPart = raw.split(/[?#]/, 1)[0]
  let decoded: string
  try {
    decoded = decodeURIComponent(pathPart)
  } catch {
    return null
  }

  const result = markdownSegments.slice(0, -1)
  for (const segment of decoded.replaceAll('\\', '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (result.length === 0) return null
      result.pop()
      continue
    }
    if (segment.includes('\0')) return null
    result.push(segment)
  }
  return result.length ? result : null
}
