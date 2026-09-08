/** 节流写入会话正文，避免每个 PTY chunk 都触发 Zustand persist */
export function createTranscriptBuffer(flush: (id: string, chunk: string) => void, ms = 400) {
  const buf = new Map<string, string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  const emit = (id: string) => {
    const chunk = buf.get(id)
    buf.delete(id)
    const t = timers.get(id)
    if (t) clearTimeout(t)
    timers.delete(id)
    if (chunk) flush(id, chunk)
  }

  return {
    push(id: string, chunk: string) {
      if (!id || !chunk) return
      buf.set(id, (buf.get(id) ?? '') + chunk)
      if (timers.has(id)) return
      timers.set(
        id,
        setTimeout(() => emit(id), ms),
      )
    },
    flushAll() {
      for (const id of [...buf.keys()]) emit(id)
    },
  }
}
