// 真实终端：主进程用 node-pty 创建 PTY，数据经 IPC 与渲染层 xterm 双向流转。
// 安全：所有 spawn 在主进程，渲染层只通过受控 IPC 交互（§9.1/9.2）。

import { ipcMain, BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { randomUUID } from 'node:crypto'
import { getCredential } from './cred'
import { assertAllowedCwd } from './pathSafe'
import { resolvePtyExecutable } from './executableResolver'
import { PtyResizeGate } from './ptyLifecycle'
import { writeCodexOverlay } from './codexOverlayWrite'
import { writeClaudeSettingsOverlay } from './claudeSettingsWrite'
import { registerOwnedResource } from './ownedResources'

export interface PtySpawnOpts {
  exe: string
  args: string[]
  cwd: string
  env?: Record<string, string>
  cols: number
  rows: number
  /** 主进程凭据引用；渲染层不得传明文密钥 */
  credentialRef?: string
  sensitiveEnvKeys?: string[]
  /** 启动前删除、避免串用线路的环境变量 */
  unsetEnvKeys?: string[]
  /** 只向该变量注入密钥；缺省则写入全部 sensitiveEnvKeys（原版兼容） */
  credentialEnv?: string
  requireCredential?: boolean
  extraEnv?: Record<string, string>
  cloneId?: string
  codexOverlay?: { cloneId: string; profileName: string; content: string; catalogModel?: string }
  claudeSettings?: {
    cloneId: string
    injectKey: 'ANTHROPIC_API_KEY' | 'ANTHROPIC_AUTH_TOKEN'
    env: Record<string, string>
  }
}

interface ManagedPty {
  process: pty.IPty
  resize: PtyResizeGate
  cloneId?: string
}

const procs = new Map<string, ManagedPty>()

function getWin(): BrowserWindow | null {
  const wins = BrowserWindow.getAllWindows()
  return wins.length ? wins[0] : null
}

/**
 * Windows 下 node-pty 的 conpty 不搜索 PATH：裸名（如 'claude'、'powershell.exe'）
 * 会被原生模块判定 File not found。这里在 spawn 前解析成绝对路径：
 *  - .exe -> 直接用绝对路径
 *  - .cmd/.bat -> 经 cmd.exe /c 启动（cmd.exe 用 ComSpec 绝对路径）
 * 非 Windows 原样返回。
 */
export function registerPtyHandlers(): void {
  ipcMain.handle('pty:spawn', async (_e, opts: PtySpawnOpts) => {
    if (!opts || typeof opts !== 'object') throw new Error('invalid pty opts')
    const exe = opts.exe || (process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash')
    const env = { ...process.env, ...(opts.env || {}) } as { [key: string]: string }
    const unsetKeys = [
      ...(Array.isArray(opts.unsetEnvKeys) ? opts.unsetEnvKeys : []),
      ...(Array.isArray(opts.sensitiveEnvKeys) ? opts.sensitiveEnvKeys : []),
    ].filter((k) => typeof k === 'string' && k)
    for (const k of new Set(unsetKeys)) delete env[k]
    if (opts.extraEnv && typeof opts.extraEnv === 'object') {
      for (const [key, value] of Object.entries(opts.extraEnv)) {
        if (typeof key === 'string' && key && typeof value === 'string') env[key] = value
      }
    }
    if (typeof opts.credentialRef === 'string' && opts.credentialRef) {
      const secret = getCredential(opts.credentialRef)
      if (opts.requireCredential && !secret) {
        throw new Error('该分身尚未配置 API Key，请先补全密钥')
      }
      if (secret) {
        const injectKey = typeof opts.credentialEnv === 'string' && opts.credentialEnv ? opts.credentialEnv : ''
        if (injectKey) env[injectKey] = secret
        else {
          const sensitiveKeys = Array.isArray(opts.sensitiveEnvKeys) ? opts.sensitiveEnvKeys.filter((k) => typeof k === 'string' && k) : []
          for (const k of sensitiveKeys) env[k] = secret
        }
      }
    } else if (opts.requireCredential) {
      throw new Error('该分身尚未配置 API Key，请先补全密钥')
    }
    if (opts.codexOverlay && typeof opts.codexOverlay === 'object') {
      const overlay = writeCodexOverlay(opts.codexOverlay)
      if (!overlay.ok) throw new Error(`无法写入 Codex profile：${overlay.reason}`)
    }
    const settingsArgs: string[] = []
    if (opts.claudeSettings && typeof opts.claudeSettings === 'object') {
      const secret =
        typeof opts.credentialRef === 'string' && opts.credentialRef ? getCredential(opts.credentialRef) : ''
      const written = writeClaudeSettingsOverlay({ ...opts.claudeSettings, secret: secret || '' })
      if (!written.ok) throw new Error(`无法写入 Claude 分身 settings：${written.reason}`)
      settingsArgs.push('--settings', written.path)
    }
    if (opts.requireCredential && typeof opts.credentialRef === 'string' && opts.credentialRef) {
      registerOwnedResource({
        kind: 'credential',
        id: opts.credentialRef,
        cloneId: opts.cloneId || opts.codexOverlay?.cloneId || opts.credentialRef.replace(/^ringcode:clone:/, ''),
      })
    }
    const cwd = opts.cwd ? assertAllowedCwd(opts.cwd) : undefined
    const resolved = resolvePtyExecutable(exe)
    const finalArgs = [...resolved.args, ...settingsArgs, ...(opts.args || [])]
    const id = randomUUID()
    const p = pty.spawn(resolved.exe, finalArgs, {
      name: 'xterm-256color',
      cols: Math.max(2, opts.cols || 80),
      rows: Math.max(1, opts.rows || 24),
      cwd,
      env: {
        ...env,
        ...(resolved.env || {}),
        TERM: env.TERM || 'xterm-256color',
        COLORTERM: env.COLORTERM || 'truecolor',
      },
    })
    const managed: ManagedPty = {
      process: p,
      resize: new PtyResizeGate(p),
      cloneId: typeof opts.cloneId === 'string' ? opts.cloneId : undefined,
    }
    procs.set(id, managed)
    p.onData((data) => {
      managed.resize.onData()
      const win = getWin()
      if (win && !win.isDestroyed()) win.webContents.send('pty:data', id, data)
    })
    p.onExit(({ exitCode }) => {
      managed.resize.markExited()
      const win = getWin()
      if (win && !win.isDestroyed()) win.webContents.send('pty:exit', id, exitCode)
      procs.delete(id)
    })
    return id
  })

  ipcMain.on('pty:input', (_e, id: string, data: string) => {
    procs.get(id)?.process.write(data)
  })

  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => {
    procs.get(id)?.resize.resize(cols, rows)
  })

  ipcMain.on('pty:dispose', (_e, id: string) => {
    const managed = procs.get(id)
    if (managed) {
      managed.resize.markExited()
      try {
        managed.process.kill()
      } catch {
        /* ignore */
      }
      procs.delete(id)
    }
  })
}

export function listRunningCloneIds(): string[] {
  return [...new Set([...procs.values()].map((item) => item.cloneId).filter((id): id is string => !!id))]
}

export function hasRunningPty(): boolean {
  return procs.size > 0
}

/** 应用退出时清理所有 PTY 子进程 */
export function disposeAllPty(): void {
  for (const managed of procs.values()) {
    managed.resize.markExited()
    try {
      managed.process.kill()
    } catch {
      /* ignore */
    }
  }
  procs.clear()
}
