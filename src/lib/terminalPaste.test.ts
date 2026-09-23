import { describe, expect, it, vi } from 'vitest'
import { Terminal } from '@xterm/xterm'
import { handleTerminalContextMenu, pasteTerminalFromContextMenu, pasteTerminalText, suppressTerminalRightMouseEvent } from './terminalPaste'

describe('pasteTerminalText', () => {
  function terminalInput(paste: (terminal: Terminal) => void): string {
    const terminal = new Terminal()
    // xterm's paste path clears its textarea; no DOM is needed for the input stream test.
    Object.assign((terminal as unknown as { _core: { textarea: unknown } })._core, { textarea: { value: '' } })
    const input: string[] = []
    terminal.onData((data) => input.push(data))
    paste(terminal)
    terminal.dispose()
    return input.join('')
  }

  it('Codex receives a two-blank-line paste as one protected input without Enter bytes', () => {
    const input = terminalInput((terminal) => {
      expect(pasteTerminalText(terminal, 'first\r\n\r\nlast', 'codex')).toBe(true)
    })

    expect(input).toBe('\x1b[200~first\n\nlast\x1b[201~')
  })

  it('other AI terminals use xterm bracketed paste when their CLI enables it', () => {
    const input = terminalInput((terminal) => {
      const core = (terminal as unknown as { _core: { coreService: { decPrivateModes: { bracketedPasteMode: boolean } } } })._core
      core.coreService.decPrivateModes.bracketedPasteMode = true
      expect(pasteTerminalText(terminal, 'first\n\nlast', 'claude')).toBe(true)
    })

    expect(input).toBe('\x1b[200~first\r\rlast\x1b[201~')
  })

  it('does not send multiline input to an AI CLI without safe paste mode', () => {
    const input = terminalInput((terminal) => {
      expect(pasteTerminalText(terminal, 'first\n\nlast', 'antigravity')).toBe(false)
    })

    expect(input).toBe('')
  })

  it('keeps ordinary single-line and shell paste behavior', () => {
    expect(terminalInput((terminal) => {
      expect(pasteTerminalText(terminal, 'hello', 'codex')).toBe(true)
    })).toBe('hello')
    expect(terminalInput((terminal) => {
      expect(pasteTerminalText(terminal, 'echo one\necho two')).toBe(true)
    })).toBe('echo one\recho two')
  })
})

describe('pasteTerminalFromContextMenu', () => {
  it('有选区时右键只打开复制菜单，不读取剪贴板或粘贴', async () => {
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() }
    const terminal = { paste: vi.fn(), focus: vi.fn(), getSelection: () => 'selected output' }
    const readClipboard = vi.fn(() => 'clipboard text')
    const showCopyMenu = vi.fn()

    await expect(handleTerminalContextMenu(event, terminal, readClipboard, showCopyMenu)).resolves.toBe('copy')
    expect(showCopyMenu).toHaveBeenCalledWith('selected output')
    expect(readClipboard).not.toHaveBeenCalled()
    expect(terminal.paste).not.toHaveBeenCalled()
  })

  it('无选区时保留右键粘贴', async () => {
    const terminal = { paste: vi.fn(), focus: vi.fn(), getSelection: () => '' }
    const result = await handleTerminalContextMenu(
      { preventDefault: vi.fn(), stopPropagation: vi.fn() },
      terminal,
      () => 'clipboard text',
      vi.fn(),
    )

    expect(result).toBe('paste')
    expect(terminal.paste).toHaveBeenCalledWith('clipboard text')
  })

  it('右键按下先在捕获阶段停止传播，避免支持鼠标的 CLI 再处理一次', () => {
    const event = { button: 2, stopPropagation: vi.fn() }

    expect(suppressTerminalRightMouseEvent(event)).toBe(true)
    expect(event.stopPropagation).toHaveBeenCalledOnce()
  })

  it('左键不被右键粘贴逻辑拦截', () => {
    const event = { button: 0, stopPropagation: vi.fn() }

    expect(suppressTerminalRightMouseEvent(event)).toBe(false)
    expect(event.stopPropagation).not.toHaveBeenCalled()
  })

  it('右键阻止默认菜单，并把系统剪贴板内容交给 xterm 粘贴', async () => {
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() }
    const terminal = { paste: vi.fn(), focus: vi.fn() }

    const pasted = await pasteTerminalFromContextMenu(event, terminal, () => '你好，Antigravity')

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
    expect(terminal.paste).toHaveBeenCalledWith('你好，Antigravity')
    expect(terminal.focus).toHaveBeenCalledOnce()
    expect(pasted).toBe(true)
  })

  it('剪贴板为空时不向终端发送内容', async () => {
    const terminal = { paste: vi.fn(), focus: vi.fn() }

    const pasted = await pasteTerminalFromContextMenu(
      { preventDefault: vi.fn(), stopPropagation: vi.fn() },
      terminal,
      () => '',
    )

    expect(terminal.paste).not.toHaveBeenCalled()
    expect(pasted).toBe(false)
  })
})
