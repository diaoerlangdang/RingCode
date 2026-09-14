import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { appLaunchCmdPath, cloneLauncherPath, LAUNCHER_MARKER, ringcodeBinDir, ringcodeHome } from './ringcodeHome'
import { registerOwnedResource } from './ownedResources'

export interface AppLaunchPointer {
  exe: string
  script: string
}

export function buildAppLaunchCmd(pointer: AppLaunchPointer): string {
  return [
    '@echo off',
    `REM ${LAUNCHER_MARKER}`,
    'setlocal',
    'set "ELECTRON_RUN_AS_NODE=1"',
    `"${pointer.exe}" "${pointer.script}" %*`,
    '',
  ].join('\r\n')
}

export function buildCloneLauncherCmd(cloneId: string, commandName: string, home = os.homedir()): string {
  const appLaunch = appLaunchCmdPath(home)
  return [
    '@echo off',
    `REM ${LAUNCHER_MARKER} cloneId=${cloneId}`,
    `REM commandName=${commandName}`,
    'setlocal',
    `if not exist "${appLaunch}" (`,
    '  echo RingCode helper is not registered. Open RingCode once, then retry.',
    '  exit /b 1',
    ')',
    `call "${appLaunch}" ${cloneId} %*`,
    '',
  ].join('\r\n')
}

export function launcherOwnedBy(content: string, cloneId?: string): boolean {
  if (!content.includes(`REM ${LAUNCHER_MARKER}`)) return false
  if (cloneId) return content.includes(`cloneId=${cloneId}`)
  return true
}

function writeCmdFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, content)
  fs.renameSync(tmp, file)
}

export function writeAppLaunchPointer(pointer: AppLaunchPointer, home = os.homedir()): { ok: true; path: string } | { ok: false; reason: string } {
  if (!pointer.exe || !pointer.script) return { ok: false, reason: '缺少应用可执行文件路径' }
  try {
    writeCmdFile(appLaunchCmdPath(home), buildAppLaunchCmd(pointer))
    return { ok: true, path: appLaunchCmdPath(home) }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

export function writeCloneLauncher(
  input: { cloneId: string; commandName: string },
  home = os.homedir(),
): { ok: true; path: string } | { ok: false; reason: string } {
  const commandName = input.commandName.trim().toLowerCase()
  if (!input.cloneId || !/^[a-z][a-z0-9-]{0,31}$/.test(commandName)) {
    return { ok: false, reason: '命令名无效' }
  }
  const file = cloneLauncherPath(commandName, home)
  try {
    if (fs.existsSync(file)) {
      const existing = fs.readFileSync(file, 'utf8')
      if (existing.trim() && !launcherOwnedBy(existing, input.cloneId)) {
        return { ok: false, reason: `已存在非本应用文件：${file}` }
      }
    }
    writeCmdFile(file, buildCloneLauncherCmd(input.cloneId, commandName, home))
    registerOwnedResource(
      { kind: 'launcher', path: file, cloneId: input.cloneId, commandName },
      path.join(ringcodeHome(home), 'owned-resources.json'),
    )
    return { ok: true, path: file }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

export function launcherStatus(
  input: { cloneId: string; commandName: string },
  home = os.homedir(),
): { ok: boolean; path: string; reason?: string } {
  const file = cloneLauncherPath(input.commandName, home)
  if (!fs.existsSync(file)) return { ok: false, path: file, reason: '系统命令尚未生成' }
  try {
    const content = fs.readFileSync(file, 'utf8')
    if (!launcherOwnedBy(content, input.cloneId)) {
      return { ok: false, path: file, reason: '目标文件不属于本分身' }
    }
    return { ok: true, path: file }
  } catch (err) {
    return { ok: false, path: file, reason: err instanceof Error ? err.message : String(err) }
  }
}

export function binDir(home = os.homedir()): string {
  return ringcodeBinDir(home)
}
