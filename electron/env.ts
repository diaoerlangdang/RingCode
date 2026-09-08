// 环境检测：查询 Agent 可执行文件是否在系统 PATH 中。
// 用于首启向导与启动前校验，避免 PTY 静默失败。

import { ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import * as path from 'node:path'
import { promises as fsp } from 'node:fs'
import { knownWindowsAgentPaths } from './agentPaths'

function which(exe: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!exe) return resolve(false)
    if (path.isAbsolute(exe)) {
      fsp
        .access(exe)
        .then(() => resolve(true))
        .catch(() => resolve(false))
      return
    }
    const known = knownWindowsAgentPaths(exe)
    if (known.length) {
      Promise.all(known.map((candidate) => fsp.access(candidate).then(() => true).catch(() => false))).then((matches) => {
        if (matches.some(Boolean)) resolve(true)
        else findOnPath()
      })
      return
    }
    findOnPath()

    function findOnPath() {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    execFile(cmd, [exe], (err, stdout) => resolve(!err && !!stdout.trim()))
    }
  })
}

export function registerEnvHandlers(): void {
  ipcMain.handle('env:which', async (_e, exe: string) => which(exe))
}
