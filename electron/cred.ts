// 真实凭据：用 @napi-rs/keyring 封装 Windows Credential Manager。
// 明文密钥绝不进配置/日志/会话，只存系统凭据库，配置里只留引用名与「是否已设置」（CFG-003/006，§9.5）。

import { ipcMain } from 'electron'
import { Entry } from '@napi-rs/keyring'

const SERVICE = 'RingCode'

function entry(key: string): Entry {
  return new Entry(SERVICE, key)
}

/** 仅主进程使用：把密钥注入 PTY 环境，不暴露给渲染层 */
export function getCredential(key: string): string | null {
  if (typeof key !== 'string' || !key) return null
  try {
    return entry(key).getPassword()
  } catch {
    return null
  }
}

export function registerCredHandlers(): void {
  ipcMain.handle('cred:set', async (_e, key: string, val: string) => {
    if (typeof key !== 'string' || typeof val !== 'string') return false
    try {
      entry(key).setPassword(val)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('cred:has', async (_e, key: string) => {
    if (typeof key !== 'string') return false
    try {
      return entry(key).getPassword() !== null
    } catch {
      return false
    }
  })

  ipcMain.handle('cred:delete', async (_e, key: string) => {
    if (typeof key !== 'string') return false
    try {
      return entry(key).deleteCredential()
    } catch {
      return false
    }
  })
}
