// 真实本地数据库：better-sqlite3，存于 userData/ringcode.db。
// 用 kv 表保存 Zustand 持久化快照（替代 localStorage）。

import { app, ipcMain } from 'electron'
import Database from 'better-sqlite3'
import * as path from 'node:path'

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (!db) {
    const file = path.join(app.getPath('userData'), 'ringcode.db')
    db = new Database(file)
    db.pragma('journal_mode = WAL')
    db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  }
  return db
}

export function registerDbHandlers(): void {
  const get = (key: string): string | null => {
    const row = getDb().prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined
    return row ? row.value : null
  }
  const set = (key: string, value: string): void => {
    getDb()
      .prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }
  const del = (key: string): void => {
    getDb().prepare('DELETE FROM kv WHERE key = ?').run(key)
  }

  ipcMain.handle('store:get', (_e, key: string) => get(key))
  ipcMain.handle('store:set', (_e, key: string, value: string) => set(key, value))
  ipcMain.handle('store:del', (_e, key: string) => del(key))
}
