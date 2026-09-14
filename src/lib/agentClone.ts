import type { AgentDef, CloneFamily, ToolProfile } from '@/types'
import { cloneableSource, isCloneAgent } from './agentFamily'
import { agentById } from './agents'

export const CLONE_COMMAND_NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/
export const CLONE_COMMAND_NAME_MAX = 32
const WINDOWS_RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
])

export interface CloneNameContext {
  agents: AgentDef[]
  profiles?: ToolProfile[]
}

export type CloneNameIssue =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'format' | 'reserved' | 'taken'; message: string }

export function cloneCredentialRef(cloneId: string): string {
  return `ringcode:clone:${cloneId}`
}

export function cloneCodexProfileName(cloneId: string): string {
  return `ringcode-${cloneId}`
}

export function isWindowsReservedName(name: string): boolean {
  const base = name.trim().toLowerCase().split('.')[0] ?? ''
  return WINDOWS_RESERVED.has(base)
}

export function validateCloneCommandName(name: string, ctx: CloneNameContext): CloneNameIssue {
  const commandName = name.trim().toLowerCase()
  if (!commandName) return { ok: false, reason: 'empty', message: '请填写命令名' }
  if (!CLONE_COMMAND_NAME_PATTERN.test(commandName) || commandName.length > CLONE_COMMAND_NAME_MAX) {
    return { ok: false, reason: 'format', message: '命令名需为小写字母开头，仅含 a-z、0-9、连字符，最长 32 位' }
  }
  if (isWindowsReservedName(commandName)) {
    return { ok: false, reason: 'reserved', message: `命令名 ${commandName} 是 Windows 保留设备名` }
  }
  const taken = new Set<string>()
  for (const agent of ctx.agents) {
    taken.add(agent.id.toLowerCase())
    if (agent.command.trim()) taken.add(agent.command.trim().toLowerCase())
    if (agent.commandName?.trim()) taken.add(agent.commandName.trim().toLowerCase())
  }
  for (const profile of ctx.profiles ?? []) {
    if (profile.command.trim()) taken.add(profile.command.trim().toLowerCase())
  }
  if (taken.has(commandName)) {
    return { ok: false, reason: 'taken', message: `命令名 ${commandName} 已占用` }
  }
  return { ok: true }
}

export function validateCloneDisplayName(name: string): CloneNameIssue {
  const display = name.trim()
  if (!display) return { ok: false, reason: 'empty', message: '请填写显示名' }
  if (display.length > 40) return { ok: false, reason: 'format', message: '显示名最长 40 个字符' }
  return { ok: true }
}

export function createCloneAgent(
  source: AgentDef,
  input: { id: string; name: string; commandName: string },
): AgentDef {
  const origin = cloneableSource(source)
  if (!origin) throw new Error('只能从 Claude Code 或 Codex 原版复制分身')
  return {
    id: input.id,
    name: input.name.trim(),
    command: origin.command,
    commandName: input.commandName.trim().toLowerCase(),
    sourceFamily: origin.id as CloneFamily,
    icon: origin.icon,
    iconMode: origin.iconMode,
    accent: origin.accent,
    defaultModel: origin.defaultModel,
    modelArgs: origin.modelArgs ? [...origin.modelArgs] : undefined,
    setupUrl: origin.setupUrl,
    session: origin.session ? { resumeArgs: [...origin.session.resumeArgs], forkArgs: origin.session.forkArgs ? [...origin.session.forkArgs] : undefined } : undefined,
    resumeFlag: origin.resumeFlag,
    initialPrompt: origin.initialPrompt
      ? origin.initialPrompt.mode === 'args'
        ? { mode: 'args', args: [...origin.initialPrompt.args] }
        : { mode: 'stdin' }
      : undefined,
    historyRoots: [...origin.historyRoots],
    permission: origin.permission
      ? {
          autoArgs: [...origin.permission.autoArgs],
          dangerousArgs: [...origin.permission.dangerousArgs],
          autoLabel: origin.permission.autoLabel,
          dangerousLabel: origin.permission.dangerousLabel,
        }
      : undefined,
  }
}

export function createCloneProfile(
  agent: AgentDef,
  sourceProfile: Pick<ToolProfile, 'command'> | undefined,
  opts: { baseUrl?: string; model?: string; modelMode?: ToolProfile['modelMode'] } = {},
): ToolProfile {
  if (!isCloneAgent(agent)) throw new Error('不是分身')
  const model = opts.model?.trim() ?? ''
  const modelMode = opts.modelMode === 'custom' && model ? 'custom' : 'default'
  return {
    id: `pf-${agent.id}-default`,
    name: `默认 · ${agent.name}`,
    scope: 'global',
    tool: agent.id,
    command: sourceProfile?.command.trim() || agent.command,
    args: '',
    model: modelMode === 'custom' ? model : '',
    modelMode,
    baseUrl: opts.baseUrl?.trim() ?? '',
    envs: [],
    terminalStrategy: 'new',
    credentialRef: cloneCredentialRef(agent.id),
    credentialSet: false,
  }
}

export function prepareImportedClone(
  rawAgent: AgentDef,
  rawProfile: ToolProfile | undefined,
  ctx: CloneNameContext & { newId: string },
): { ok: true; agent: AgentDef; profile: ToolProfile } | { ok: false; message: string } {
  if (!isCloneAgent(rawAgent)) return { ok: false, message: '只能导入 Claude/Codex 分身' }
  const nameCheck = validateCloneDisplayName(rawAgent.name)
  if (!nameCheck.ok) return { ok: false, message: nameCheck.message }
  const cmdCheck = validateCloneCommandName(rawAgent.commandName ?? '', ctx)
  if (!cmdCheck.ok) return { ok: false, message: cmdCheck.message }
  const origin = cloneableSource(agentById(rawAgent.sourceFamily!))
  if (!origin) return { ok: false, message: '原版 Agent 不存在' }
  const agent = createCloneAgent(origin, {
    id: ctx.newId,
    name: rawAgent.name,
    commandName: rawAgent.commandName!,
  })
  const profile = createCloneProfile(agent, { command: rawProfile?.command || rawAgent.command }, {
    baseUrl: rawProfile?.baseUrl,
    model: rawProfile?.model,
    modelMode: rawProfile?.modelMode,
  })
  return { ok: true, agent, profile }
}
