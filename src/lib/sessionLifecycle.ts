export function rehydratePersistedSlice<Term extends { orphaned?: boolean }, Sess extends { status: string }>(state: {
  terminals?: Term[]
  sessions?: Sess[]
}): { terminals: Term[]; sessions: Sess[] } {
  const terminals = (state.terminals ?? []).map((t) => ({ ...t, orphaned: true as const }))
  const sessions = (state.sessions ?? []).map((s) =>
    s.status === 'running' ? { ...s, status: 'interrupted' as Sess['status'] } : s,
  )
  return { terminals, sessions }
}

export function shouldDiscardEmptySession(
  session: { conversationStarted?: boolean; favorite?: boolean; autoTitled?: boolean },
  terminal: { kind: string; action?: string; resume?: boolean },
): boolean {
  // undefined 代表旧版本记录；无法可靠判断是否交谈过，因此只清理由新版本明确标为空的会话。
  if (session.conversationStarted !== false || terminal.kind !== 'ai') return false
  const action = terminal.action ?? (terminal.resume ? 'resume' : 'new')
  return action === 'new' && !session.favorite && session.autoTitled !== false
}

/** 只把“提交非空文本”视作开始对话；光标键、Ctrl+C、空回车都不算。 */
export function createConversationInputTracker(): { push: (data: string) => boolean } {
  let pendingCharacters = 0
  let escapeState: 'none' | 'escape' | 'csi' = 'none'

  return {
    push(data) {
      let submitted = false
      for (const ch of data) {
        const code = ch.charCodeAt(0)
        if (escapeState === 'escape') {
          escapeState = ch === '[' ? 'csi' : 'none'
          continue
        }
        if (escapeState === 'csi') {
          if (code >= 0x40 && code <= 0x7e) escapeState = 'none'
          continue
        }
        if (ch === '\u001b') {
          escapeState = 'escape'
          continue
        }
        if (ch === '\r' || ch === '\n') {
          if (pendingCharacters > 0) submitted = true
          pendingCharacters = 0
          continue
        }
        if (ch === '\b' || ch === '\u007f') {
          pendingCharacters = Math.max(0, pendingCharacters - 1)
          continue
        }
        if (code >= 0x20) pendingCharacters += 1
      }
      return submitted
    },
  }
}
