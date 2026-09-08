import { describe, it, expect, vi, beforeEach } from 'vitest'
import { terminalRegistry, registerTerminalTarget, pasteToTerminal } from './terminalRegistry'

describe('terminalRegistry', () => {
  beforeEach(() => {
    terminalRegistry.clear()
  })

  it('registers and retrieves terminal target', () => {
    const target = { paste: vi.fn(), focus: vi.fn() }
    const unregister = registerTerminalTarget('tab-1', target)

    expect(terminalRegistry.get('tab-1')).toBe(target)

    unregister()
    expect(terminalRegistry.get('tab-1')).toBeUndefined()
  })

  it('pastes to registered terminal target and focuses it', () => {
    const target = { paste: vi.fn(), focus: vi.fn() }
    registerTerminalTarget('tab-ai', target)

    const success = pasteToTerminal('tab-ai', 'console.log("hello")\n')
    expect(success).toBe(true)
    expect(target.focus).toHaveBeenCalledOnce()
    expect(target.paste).toHaveBeenCalledWith('console.log("hello")\n')
  })

  it('returns false when target is not found', () => {
    const success = pasteToTerminal('unknown-tab', 'code')
    expect(success).toBe(false)
  })
})

