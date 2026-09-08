import * as path from 'node:path'

/** CLI 安装器已公开、但当前桌面进程 PATH 可能尚未刷新的 Windows 用户级目录。 */
export function knownWindowsAgentPaths(exe: string, env: NodeJS.ProcessEnv = process.env): string[] {
  if (process.platform !== 'win32') return []
  const name = path.basename(exe).toLowerCase().replace(/\.exe$/, '')
  if (name === 'agy' && env.LOCALAPPDATA) return [path.join(env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe')]
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
