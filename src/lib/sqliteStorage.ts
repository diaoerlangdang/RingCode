// Zustand 持久化存储适配器：
//  - Electron：主进程 better-sqlite3（真实 SQLite，userData/ringcode.db）
//  - Web：localStorage 兜底
import type { StateStorage } from 'zustand/middleware'

function isElectron(): boolean {
  return !!window.ringcode?.isElectron
}

export const sqliteStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (isElectron()) return window.ringcode!.storeGet(name)
    return localStorage.getItem(name)
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (isElectron()) await window.ringcode!.storeSet(name, value)
    else localStorage.setItem(name, value)
  },
  removeItem: async (name: string): Promise<void> => {
    if (isElectron()) await window.ringcode!.storeDel(name)
    else localStorage.removeItem(name)
  },
}
