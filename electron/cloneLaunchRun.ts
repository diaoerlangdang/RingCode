import { spawn } from 'node:child_process'
import * as os from 'node:os'
import { getCredential } from './cred'
import { applyCloneLaunchEnv, cloneLaunchEnvPlan } from './cloneLaunchEnv'
import { buildCodexOverlayToml } from './cloneOverlayToml'
import { writeCodexOverlay } from './codexOverlayWrite'
import { writeClaudeSettingsOverlay } from './claudeSettingsWrite'
import { readCloneSnapshot, type CloneSnapshot } from './cloneSnapshot'
import { resolveExecutablePath } from './executableResolver'

export function stripCodexProfileArgs(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--profile') {
      i += 1
      continue
    }
    out.push(args[i]!)
  }
  return out
}

export function buildCloneHelperArgv(snapshot: CloneSnapshot, userArgs: string[]): string[] {
  const forwarded = snapshot.family === 'codex' ? stripCodexProfileArgs(userArgs) : [...userArgs]
  const args: string[] = []
  if (snapshot.family === 'codex' && snapshot.codexProfileName) {
    args.push('--profile', snapshot.codexProfileName)
  }
  if (snapshot.modelMode === 'custom' && snapshot.model.trim()) {
    args.push('--model', snapshot.model.trim())
  }
  if (snapshot.permission === 'auto') {
    if (snapshot.family === 'claude') args.push('--permission-mode', 'auto')
    else args.push('--ask-for-approval', 'never', '--sandbox', 'workspace-write')
  } else if (snapshot.permission === 'dangerous') {
    if (snapshot.family === 'claude') args.push('--dangerously-skip-permissions')
    else args.push('--dangerously-bypass-approvals-and-sandbox')
  }
  args.push(...forwarded)
  return args
}

export async function runCloneLaunch(
  cloneId: string,
  userArgs: string[],
  options: { home?: string; env?: NodeJS.ProcessEnv; cwd?: string; spawnProcess?: typeof spawn } = {},
): Promise<number> {
  const home = options.home ?? os.homedir()
  const snapshot = readCloneSnapshot(cloneId, home)
  if ('ok' in snapshot && snapshot.ok === false) {
    process.stderr.write(`${snapshot.reason}\n`)
    return 1
  }
  const config = snapshot as CloneSnapshot
  const secret = getCredential(config.credentialRef)
  if (!secret) {
    process.stderr.write(`分身 ${config.name} 尚未配置 API Key，请先在 RingCode 中补全密钥。\n`)
    return 1
  }
  const helperArgs = buildCloneHelperArgv(config, userArgs)
  let args = helperArgs
  if (config.family === 'claude') {
    const injectKey = config.baseUrl.trim() ? 'ANTHROPIC_AUTH_TOKEN' : 'ANTHROPIC_API_KEY'
    const written = writeClaudeSettingsOverlay(
      {
        cloneId: config.cloneId,
        injectKey,
        env: {
          ANTHROPIC_API_KEY: '',
          ANTHROPIC_AUTH_TOKEN: '',
          ANTHROPIC_BASE_URL: config.baseUrl.trim(),
          ANTHROPIC_MODEL: config.modelMode === 'custom' ? config.model.trim() : '',
          ANTHROPIC_DEFAULT_HAIKU_MODEL: config.modelMode === 'custom' ? config.model.trim() : '',
          ANTHROPIC_DEFAULT_SONNET_MODEL: config.modelMode === 'custom' ? config.model.trim() : '',
          ANTHROPIC_DEFAULT_OPUS_MODEL: config.modelMode === 'custom' ? config.model.trim() : '',
          ANTHROPIC_DEFAULT_FABLE_MODEL: config.modelMode === 'custom' ? config.model.trim() : '',
          CLAUDE_CODE_SUBAGENT_MODEL: config.modelMode === 'custom' ? config.model.trim() : '',
        },
        secret,
      },
      home,
    )
    if (!written.ok) {
      process.stderr.write(`无法写入 Claude 分身 settings：${written.reason}\n`)
      return 1
    }
    args = ['--settings', written.path, ...helperArgs]
  }
  if (config.family === 'codex' && config.codexProfileName) {
    const overlay = buildCodexOverlayToml({
      cloneId: config.cloneId,
      profileName: config.codexProfileName,
      baseUrl: config.baseUrl,
      model: config.model,
      modelMode: config.modelMode,
    })
    const written = writeCodexOverlay(
      {
        cloneId: config.cloneId,
        profileName: overlay.profileName,
        content: overlay.content,
        catalogModel: config.model.trim() || 'gpt-5',
      },
      home,
    )
    if (!written.ok) {
      process.stderr.write(`无法写入 Codex profile：${written.reason}\n`)
      return 1
    }
  }
  let exe: string
  try {
    exe = resolveExecutablePath(config.command, { env: options.env ?? process.env })
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
  const plan = cloneLaunchEnvPlan(config.family, config.baseUrl)
  const env = applyCloneLaunchEnv(options.env ?? process.env, plan, secret)
  const child = (options.spawnProcess ?? spawn)(exe, args, {
    cwd: options.cwd ?? process.cwd(),
    env,
    stdio: 'inherit',
    windowsHide: false,
  })
  return await new Promise((resolve) => {
    const forward = (signal: NodeJS.Signals) => {
      try {
        child.kill(signal)
      } catch {
        /* ignore */
      }
    }
    process.on('SIGINT', forward)
    process.on('SIGTERM', forward)
    child.on('error', (err) => {
      process.stderr.write(`${err.message}\n`)
      resolve(1)
    })
    child.on('exit', (code, signal) => {
      process.removeListener('SIGINT', forward)
      process.removeListener('SIGTERM', forward)
      if (signal) resolve(1)
      else resolve(code ?? 1)
    })
  })
}
