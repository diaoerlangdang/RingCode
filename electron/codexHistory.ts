/** Codex 把总结标题写在 ~/.codex/session_index.jsonl 的 thread_name，不在 rollout jsonl 里。 */

export function parseCodexSessionIndex(raw: string): Map<string, string> {
  const names = new Map<string, string>()
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim()
    if (!text) continue
    let row: Record<string, unknown>
    try {
      row = JSON.parse(text) as Record<string, unknown>
    } catch {
      continue
    }
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    const name = typeof row.thread_name === 'string' ? row.thread_name.trim() : ''
    if (!id || !name) continue
    names.set(id, name)
  }
  return names
}
