// Zustand 持久化存储适配器：
//  - Electron：主进程 better-sqlite3（真实 SQLite，userData/ringcode.db）
//  - Web：localStorage 兜底
import type { StateStorage } from 'zustand/middleware'

function isElectron(): boolean {
  return !!window.ringcode?.isElectron
}

export const transcriptKey = (id: string): string => `ringcode-transcript:${id}`

async function readItem(name: string): Promise<string | null> {
  if (isElectron()) return window.ringcode!.storeGet(name)
  return localStorage.getItem(name)
}

async function writeItem(name: string, value: string): Promise<void> {
  if (isElectron()) await window.ringcode!.storeSet(name, value)
  else localStorage.setItem(name, value)
}

export const sqliteStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const raw = await readItem(name)
    if (name !== 'ringcode-store' || !raw) return raw
    let saved: { state?: { sessions?: { id: string; transcript?: string }[] } }
    try {
      saved = JSON.parse(raw)
    } catch {
      return raw
    }
    const sessions = saved.state?.sessions
    if (!Array.isArray(sessions)) return raw
    // Older snapshots embedded transcript text; move it without dropping any local history.
    await Promise.all(sessions.map(async (session) => {
      const key = transcriptKey(session.id)
      const separate = await readItem(key)
      if (separate !== null) session.transcript = separate
      else if (session.transcript) await writeItem(key, session.transcript)
      else session.transcript = ''
    }))
    return JSON.stringify(saved)
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await writeItem(name, value)
  },
  removeItem: async (name: string): Promise<void> => {
    if (isElectron()) await window.ringcode!.storeDel(name)
    else localStorage.removeItem(name)
  },
}
