/** 简易参数解析：按空格切分，保留引号内的整体 */
export function parseArgs(s: string): string[] {
  if (!s.trim()) return []
  return (s.match(/"[^"]+"|\S+/g) || []).map((a) => a.replace(/^"|"$/g, ''))
}
