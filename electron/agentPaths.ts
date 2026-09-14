import * as fs from 'node:fs'
import * as path from 'node:path'

function tryListDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

/** CLI 安装器已公开、但当前桌面进程 PATH 可能尚未刷新的 Windows 用户级目录。 */
export function knownWindowsAgentPaths(
  exe: string,
  env: NodeJS.ProcessEnv = process.env,
  listDir: (dir: string) => string[] = tryListDir,
): string[] {
  if (process.platform !== 'win32') return []
  const name = path.basename(exe).toLowerCase().replace(/\.exe$/, '')
  if (name === 'agy' && env.LOCALAPPDATA) return [path.join(env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe')]
  if (name === 'codex') {
    const out: string[] = []
    if (env.CODEX_CLI_PATH) out.push(env.CODEX_CLI_PATH)
    const binRoot = env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin') : ''
    if (binRoot) {
      for (const entry of listDir(binRoot)) {
        out.push(path.join(binRoot, entry, 'codex.exe'))
      }
    }
    return [...new Set(out)]
  }
  if (name !== 'opencode') return []

  const candidates = [
    env.OPENCODE_INSTALL_DIR && path.join(env.OPENCODE_INSTALL_DIR, 'opencode.exe'),
    env.XDG_BIN_DIR && path.join(env.XDG_BIN_DIR, 'opencode.exe'),
    env.USERPROFILE && path.join(env.USERPROFILE, 'bin', 'opencode.exe'),
    env.USERPROFILE && path.join(env.USERPROFILE, '.opencode', 'bin', 'opencode.exe'),
    env.APPDATA && path.join(
      env.APPDATA,
      'npm',
      'node_modules',
      'opencode-ai',
      'node_modules',
      `opencode-windows-${process.arch === 'arm64' ? 'arm64' : 'x64'}`,
      'bin',
      'opencode.exe',
    ),
    env.APPDATA && path.join(env.APPDATA, 'npm', 'opencode.cmd'),
    env.USERPROFILE && path.join(env.USERPROFILE, 'scoop', 'shims', 'opencode.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'opencode.exe'),
    env.ProgramData && path.join(env.ProgramData, 'chocolatey', 'bin', 'opencode.exe'),
  ].filter((value): value is string => !!value)
  return [...new Set(candidates)]
}
