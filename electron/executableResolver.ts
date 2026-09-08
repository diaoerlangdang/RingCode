import * as fs from 'node:fs'
import * as path from 'node:path'
import { knownWindowsAgentPaths } from './agentPaths'

interface ResolveOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  exists?: (file: string) => boolean
}

export interface PtyExecutable {
  exe: string
  args: string[]
  env?: Record<string, string>
}

function existingFile(file: string): boolean {
  try {
    fs.accessSync(file)
    return true
  } catch {
    return false
  }
}

export function resolveExecutablePath(input: string, options: ResolveOptions = {}): string {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const exists = options.exists ?? existingFile
  const requested = input || (platform === 'win32' ? 'powershell.exe' : env.SHELL || 'bash')
  if (platform !== 'win32') return requested

  if (path.isAbsolute(requested)) {
    if (exists(requested)) return requested
    throw new Error(`未找到可执行文件“${requested}”。请在设置的配置方案中重新选择有效路径。`)
  }

  for (const candidate of knownWindowsAgentPaths(requested, env)) {
    if (exists(candidate)) return candidate
  }
  const exts = (env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean)
  const dirs = (env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    for (const ext of exts) {
      const withExt = requested.toLowerCase().endsWith(ext.toLowerCase()) ? requested : requested + ext
      const candidate = path.join(dir, withExt)
      if (exists(candidate)) return candidate
    }
  }
  throw new Error(
    `未找到可执行文件“${requested}”。如果只安装了桌面应用，请另行安装 CLI；也可以在设置的配置方案中手动选择可执行文件。`,
  )
}

/** 将裸命令解析成 node-pty 可直接创建的进程；脚本启动器由 cmd.exe 承载。 */
export function resolvePtyExecutable(input: string, options: ResolveOptions = {}): PtyExecutable {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const file = resolveExecutablePath(input, options)
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
    // node-pty 不会为 /c 后的批处理路径保留引号，`C:\Program Files\...`
    // 会被 cmd.exe 截断为 `C:\Program`。通过该子进程独享的环境变量展开
    // 已加引号的路径，既保留后续独立 argv，也避免拼接用户参数为 shell 字符串。
    return {
      exe: env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', '%RINGCODE_BATCH_ENTRY%'],
      env: { RINGCODE_BATCH_ENTRY: `"${file}"` },
    }
  }
  return { exe: file, args: [] }
}
