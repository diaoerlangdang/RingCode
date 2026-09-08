/** 仅允许通过系统浏览器打开 http(s) 链接（PRD §9.6） */
export function isAllowedExternalUrl(url: string): boolean {
  if (typeof url !== 'string' || !url) return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
