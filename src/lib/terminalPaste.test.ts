import { describe, expect, it, vi } from 'vitest'
import { pasteTerminalFromContextMenu, suppressTerminalRightMouseEvent } from './terminalPaste'

describe('pasteTerminalFromContextMenu', () => {
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
