import * as os from 'node:os'
import * as path from 'node:path'

export const RINGCODE_DIR_NAME = '.ringcode'
export const LAUNCHER_MARKER = 'Owned by RingCode.'

export function ringcodeHome(home = os.homedir()): string {
  return path.join(home, RINGCODE_DIR_NAME)
}

export function ringcodeBinDir(home = os.homedir()): string {
  return path.join(ringcodeHome(home), 'bin')
}

export function ringcodeClonesDir(home = os.homedir()): string {
  return path.join(ringcodeHome(home), 'clones')
}

export function ownedResourcesPath(home = os.homedir()): string {
  return path.join(ringcodeHome(home), 'owned-resources.json')
}

export function appLaunchCmdPath(home = os.homedir()): string {
  return path.join(ringcodeHome(home), 'app-launch.cmd')
}

export function cloneSnapshotPath(cloneId: string, home = os.homedir()): string {
  return path.join(ringcodeClonesDir(home), `${cloneId}.json`)
}

export function cloneLauncherPath(commandName: string, home = os.homedir()): string {
  return path.join(ringcodeBinDir(home), `${commandName}.cmd`)
}

export function claudeSettingsPath(cloneId: string, home = os.homedir()): string {
  return path.join(ringcodeHome(home), 'claude-settings', `${cloneId}.json`)
}
