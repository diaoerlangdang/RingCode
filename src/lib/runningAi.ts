import type { TerminalTab } from '@/types'

export function runningAiTerminals(terminals: TerminalTab[], agentId?: string): TerminalTab[] {
  return terminals.filter(
    (terminal) => terminal.kind === 'ai' && !terminal.orphaned && (!agentId || terminal.tool === agentId),
  )
}
