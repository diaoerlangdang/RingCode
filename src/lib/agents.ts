import { parseArgs } from './parseArgs'
import type { AgentDef, PermissionChoice, ToolProfile } from '@/types'

export type { AgentDef, PermissionChoice }

export const BUILTIN_AGENTS: AgentDef[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    icon: './claude.png',
    accent: 'var(--accent-soft)',
    credentialEnv: 'ANTHROPIC_API_KEY',
    credentialRef: 'ringcode:anthropic-key',
    defaultModel: 'claude-sonnet-5',
    modelArgs: ['--model', '{model}'],
    setupUrl: 'https://docs.claude.com/en/docs/claude-code/setup',
    shortcutDigit: '1',
    resumeFlag: '--resume',
    session: {
      resumeArgs: ['--resume', '{id}'],
      forkArgs: ['--resume', '{id}', '--fork-session'],
    },
    historyRoots: ['.claude/projects'],
    initialPrompt: { mode: 'args', args: ['{prompt}'] },
    permission: {
      autoArgs: ['--permission-mode', 'auto'],
      dangerousArgs: ['--dangerously-skip-permissions'],
      autoLabel: 'Auto 模式（--permission-mode auto，按分类器自动批准）',
      dangerousLabel: '危险启动（--dangerously-skip-permissions，跳过全部权限确认）',
    },
  },
  {
    id: 'codex',
    name: 'Codex',
    command: 'codex',
    icon: './codex.png',
    iconMode: 'mono',
    accent: 'rgba(81,207,102,0.14)',
    credentialEnv: 'OPENAI_API_KEY',
    credentialRef: 'ringcode:openai-key',
    defaultModel: 'gpt-5',
    modelArgs: ['--model', '{model}'],
    setupUrl: 'https://github.com/openai/codex',
    shortcutDigit: '2',
    resumeFlag: '--resume',
    session: {
      resumeArgs: ['resume', '{id}'],
      forkArgs: ['fork', '{id}'],
    },
    historyRoots: ['.codex/sessions'],
    initialPrompt: { mode: 'args', args: ['{prompt}'] },
    permission: {
      autoArgs: ['--ask-for-approval', 'never', '--sandbox', 'workspace-write'],
      dangerousArgs: ['--dangerously-bypass-approvals-and-sandbox'],
      autoLabel: 'Auto 模式（不询问，允许修改当前工作区）',
      dangerousLabel: '危险启动（跳过审批并关闭沙箱）',
    },
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    icon: './opencode.png',
    iconMode: 'color',
    accent: 'rgba(46, 204, 113, 0.16)',
    modelArgs: ['--model', '{model}'],
    setupUrl: 'https://opencode.ai/docs/',
    shortcutDigit: '3',
    session: {
      resumeArgs: ['--session', '{id}'],
      forkArgs: ['--session', '{id}', '--fork'],
    },
    historyRoots: [],
    initialPrompt: { mode: 'args', args: ['--prompt', '{prompt}'] },
    permission: {
      autoArgs: ['--auto'],
      dangerousArgs: ['--auto'],
      autoLabel: 'Auto 模式（--auto，自动批准未被明确拒绝的操作）',
      dangerousLabel: 'Auto 模式（--auto，与 Auto 相同）',
    },
  },
  {
    id: 'antigravity',
    name: 'Antigravity CLI',
    command: 'agy',
    icon: './gemini.png',
    iconMode: 'color',
    accent: 'rgba(66, 133, 244, 0.16)',
    modelArgs: ['--model', '{model}'],
    setupUrl: 'https://antigravity.google/docs/cli/install/',
    shortcutDigit: '4',
    resumeFlag: '--conversation',
    session: {
      resumeArgs: ['--conversation', '{id}'],
    },
    historyRoots: ['.gemini/antigravity-cli/cache'],
    initialPrompt: { mode: 'args', args: ['--prompt-interactive', '{prompt}'] },
    permission: {
      autoArgs: ['--mode=accept-edits'],
      dangerousArgs: ['--dangerously-skip-permissions'],
      autoLabel: 'Accept Edits（--mode=accept-edits，自动批准文件编辑）',
      dangerousLabel: '危险启动（--dangerously-skip-permissions，自动批准全部工具调用）',
    },
  },
  {
    id: 'hermes',
    name: 'Hermes',
    command: 'hermes',
    icon: './hermes.png',
    iconMode: 'mono',
    accent: 'rgba(232, 168, 56, 0.18)',
    setupUrl: 'https://hermes-agent.nousresearch.com/docs/user-guide/cli',
    shortcutDigit: '5',
    resumeFlag: '--resume',
    session: {
      resumeArgs: ['--resume', '{id}'],
    },
    historyRoots: ['.hermes'],
    initialPrompt: { mode: 'stdin' },
    permission: {
      autoArgs: ['--yolo'],
      dangerousArgs: ['--yolo'],
      autoLabel: 'YOLO 模式（--yolo，自动批准工具调用）',
      dangerousLabel: 'YOLO 模式（--yolo，与 Auto 相同）',
    },
  },
]

export function agentById(id: string, extra: AgentDef[] = []): AgentDef | undefined {
  return BUILTIN_AGENTS.find((a) => a.id === id) ?? extra.find((a) => a.id === id)
}

export function listAgents(extra: AgentDef[] = []): AgentDef[] {
  const seen = new Set(BUILTIN_AGENTS.map((a) => a.id))
  return [...BUILTIN_AGENTS, ...extra.filter((a) => a.id && !seen.has(a.id))]
}

export function agentLabel(id: string, extra: AgentDef[] = []): string {
  return agentById(id, extra)?.name ?? (id === 'custom' ? '自定义' : id)
}

/**
 * Codex 对 WT_SESSION 使用整屏换行策略，避免局部 DEC scroll region 在 xterm.js 中丢失历史行。
 * 值只需非空；用户配置方案中的同名环境变量仍可覆盖。
 */
export function terminalCompatibilityEnv(agentId: string, terminalId: string): Record<string, string> {
  return agentId === 'codex' ? { WT_SESSION: `RingCode-${terminalId}` } : {}
}

function hasOwnPermissionFlags(args: string[], agent: AgentDef): boolean {
  const flags = new Set(
    [...(agent.permission?.autoArgs ?? []), ...(agent.permission?.dangerousArgs ?? [])].filter((a) => a.startsWith('-')),
  )
  return args.some((a) => flags.has(a))
}

export function supportsNativeFork(agent: AgentDef): boolean {
  return !!agent.session?.forkArgs?.length
}

function expandSessionArgs(template: string[] | undefined, nativeSessionId: string | undefined): string[] {
  if (!template?.length || !nativeSessionId) return []
  return template.map((arg) => arg.replaceAll('{id}', nativeSessionId))
}

function expandArgs(template: string[] | undefined, key: string, value: string | undefined): string[] {
  const clean = value?.trim()
  if (!template?.length || !clean) return []
  return template.map((arg) => arg.replaceAll(`{${key}}`, clean))
}

function templateFlags(template: string[] | undefined): Set<string> {
  return new Set((template ?? []).filter((arg) => arg.startsWith('-')))
}

export function usesInitialPromptStdin(agent: AgentDef): boolean {
  return agent.initialPrompt?.mode === 'stdin'
}

export function sessionArgsFor(
  agent: AgentDef,
  action: 'new' | 'resume' | 'fork',
  nativeSessionId?: string,
): string[] {
  if (action === 'new') return []
  const template = action === 'fork' ? agent.session?.forkArgs : agent.session?.resumeArgs
  if (template) return expandSessionArgs(template, nativeSessionId)
  if (action === 'resume' && agent.resumeFlag && nativeSessionId) return [agent.resumeFlag, nativeSessionId]
  return []
}

/** 由原生会话动作 + 配置方案参数 + 权限选项拼出最终 argv（不含可执行文件名）。 */
export function buildLaunchArgs(
  agent: AgentDef,
  profileArgs: string,
  opts: {
    permission?: PermissionChoice
    action?: 'new' | 'resume' | 'fork'
    nativeSessionId?: string
    initialPrompt?: string
    model?: string
    modelMode?: 'default' | 'custom'
    /** @deprecated */ resumeId?: string
    /** @deprecated */ resume?: boolean
  } = {},
): string[] {
  const profile = parseArgs(profileArgs)
  const action = opts.action ?? (opts.resume || opts.resumeId ? 'resume' : 'new')
  const nativeSessionId = opts.nativeSessionId ?? opts.resumeId
  const args = [...sessionArgsFor(agent, action, nativeSessionId), ...profile]

  if (opts.modelMode === 'custom' && opts.model?.trim()) {
    const flags = templateFlags(agent.modelArgs)
    if (!profile.some((arg) => flags.has(arg))) args.push(...expandArgs(agent.modelArgs, 'model', opts.model))
  }

  if (agent.permission && !hasOwnPermissionFlags(profile, agent)) {
    if (opts.permission === 'auto') args.push(...agent.permission.autoArgs)
    else if (opts.permission === 'dangerous') args.push(...agent.permission.dangerousArgs)
  }
  if (opts.initialPrompt?.trim() && action === 'new' && agent.initialPrompt?.mode === 'args') {
    args.push(...expandArgs(agent.initialPrompt.args, 'prompt', opts.initialPrompt))
  }
  return args
}

export function seedProfilesFromAgents(): ToolProfile[] {
  return BUILTIN_AGENTS.map((a) => ({
    id: `pf-${a.id}-default`,
    name: `默认 · ${a.name}`,
    scope: 'global' as const,
    tool: a.id,
    command: a.command,
    args: '',
    model: a.defaultModel ?? '',
    modelMode: 'default' as const,
    envs: a.credentialEnv ? [{ key: a.credentialEnv, value: '', sensitive: true }] : [],
    terminalStrategy: 'new' as const,
    credentialRef: a.credentialRef,
    credentialSet: false,
  }))
}

export function migrateProfilesForBuiltinAgents(existing: ToolProfile[]): ToolProfile[] {
  const profiles: ToolProfile[] = existing.map((profile) => {
    const legacyGemini = profile.tool === 'gemini'
    return {
      ...profile,
      id: legacyGemini && profile.id === 'pf-gemini-default' ? 'pf-antigravity-default' : profile.id,
      name: legacyGemini ? profile.name.replace(/Gemini CLI/gi, 'Antigravity CLI') : profile.name,
      tool: legacyGemini ? 'antigravity' : profile.tool,
      command: legacyGemini && profile.command.trim().toLowerCase() === 'gemini' ? 'agy' : profile.command,
      model: legacyGemini && profile.model === 'auto' ? '' : profile.model,
      modelMode: profile.modelMode === 'custom' ? 'custom' as const : 'default' as const,
    }
  })
  for (const seed of seedProfilesFromAgents()) {
    if (!profiles.some((profile) => profile.tool === seed.tool)) profiles.push(seed)
  }
  return profiles
}

export function terminalTitleFor(agentId: string, index: number, extra: AgentDef[] = []): string {
  const name = agentById(agentId, extra)?.name ?? agentId
  const mark = index > 1 ? '②③④⑤⑥'[index - 2] || `(${index})` : '①'
  return `${name}  ${mark}`
}
