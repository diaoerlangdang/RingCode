// Mock PTY：在无真实 ConPTY/node-pty 时模拟一个 PowerShell 风格 shell，
// 并在键入任一内置 Agent 命令（或以 ai 模式启动）时展示 AI 会话横幅。
// 真实环境由 Electron 主进程 node-pty 提供，渲染层接口相同（out/input/resize/dispose）。

export type MockTool = string

export interface PtyCallbacks {
  out: (s: string) => void
  onSessionStart?: (tool: MockTool) => void
  onSessionEnd?: () => void
}

const C = {
  dim: '\x1b[38;5;245m',
  blue: '\x1b[38;5;75m',
  green: '\x1b[38;5;114m',
  reset: '\x1b[0m',
}

export class MockPty {
  private buf = ''
  private mode: 'shell' | 'ai'
  private tool?: MockTool
  private cb: PtyCallbacks
  private cwd = 'E:\\workspace'

  constructor(cb: PtyCallbacks, initial?: { mode: 'shell' | 'ai'; tool?: MockTool }) {
    this.cb = cb
    this.mode = initial?.mode ?? 'shell'
    this.tool = initial?.tool
    if (this.mode === 'ai' && this.tool) this.writeBanner()
    else this.writePrompt()
  }

  private writePrompt() {
    this.cb.out(`${C.dim}PS ${this.cwd}>${C.reset} `)
  }

  private writeBanner() {
    if (this.tool === 'claude') {
      this.cb.out(`${C.blue}╭─ Claude Code v1.x ─────────────────────╮${C.reset}\r\n`)
      this.cb.out('  欢迎回来。这是 AI 会话发生的地方。\r\n')
      this.cb.out('  /help 查看命令 · /resume 继续历史会话\r\n')
      this.cb.out(`${C.blue}╰────────────────────────────────────────╯${C.reset}\r\n`)
    } else if (this.tool === 'hermes') {
      this.cb.out(`${C.blue}╭─ Hermes Agent ─────────────────────────╮${C.reset}\r\n`)
      this.cb.out('  Hermes 已就绪。输入需求，回车发送。\r\n')
      this.cb.out(`${C.blue}╰────────────────────────────────────────╯${C.reset}\r\n`)
    } else {
      this.cb.out(`${C.green}╭─ ${this.tool ?? 'Codex'} ────────────────────────────────╮${C.reset}\r\n`)
      this.cb.out('  已就绪。输入需求，回车发送。\r\n')
      this.cb.out(`${C.green}╰────────────────────────────────────────╯${C.reset}\r\n`)
    }
    this.cb.out(`${C.dim}>${C.reset} `)
  }

  private promptOrAi() {
    if (this.mode === 'ai') this.cb.out(`${C.dim}>${C.reset} `)
    else this.writePrompt()
  }

  input(data: string) {
    for (const ch of data) {
      const code = ch.charCodeAt(0)
      if (ch === '\r' || code === 10) {
        this.cb.out('\r\n')
        this.processLine()
        this.buf = ''
      } else if (code === 127 || code === 8) {
        // backspace / Ctrl+H
        if (this.buf.length > 0) {
          this.buf = this.buf.slice(0, -1)
          this.cb.out('\b \b')
        }
      } else if (code === 3) {
        // Ctrl+C
        this.cb.out('^C\r\n')
        this.buf = ''
        this.promptOrAi()
      } else if (code >= 32) {
        this.buf += ch
        this.cb.out(ch)
      }
    }
  }

  private processLine() {
    const line = this.buf.trim()
    if (this.mode === 'ai') {
      this.handleAi(line)
      return
    }
    const [cmd, ...args] = line.split(/\s+/)
    if (!cmd) {
      this.writePrompt()
      return
    }
    switch (cmd.toLowerCase()) {
      case 'help':
        this.cb.out('可用命令: dir ls cd cls clear echo pwd date whoami ver claude codex opencode agy hermes exit\r\n')
        break
      case 'cls':
      case 'clear':
        this.cb.out('\x1b[2J\x1b[H')
        break
      case 'dir':
      case 'ls':
        this.cb.out('  目录: E:\\workspace\r\n\r\n')
        this.cb.out('  components   <DIR>\r\n')
        this.cb.out('  utils        <DIR>\r\n')
        this.cb.out('  hooks        <DIR>\r\n')
        this.cb.out('  app.tsx\r\n')
        this.cb.out('  main.tsx\r\n')
        this.cb.out('  index.css\r\n')
        this.cb.out('  vite.config.ts\r\n')
        this.cb.out('  README.md\r\n')
        break
      case 'pwd':
        this.cb.out(this.cwd + '\r\n')
        break
      case 'echo':
        this.cb.out(args.join(' ') + '\r\n')
        break
      case 'cd':
        if (args[0]) this.cwd = args[0]
        break
      case 'date':
        this.cb.out(new Date().toString() + '\r\n')
        break
      case 'whoami':
        this.cb.out('ringcode\\user\r\n')
        break
      case 'ver':
        this.cb.out('金刚琢 Mock Shell [Version 0.3.1]\r\n')
        break
      case 'claude':
      case 'codex':
      case 'opencode':
      case 'agy':
      case 'hermes':
        this.mode = 'ai'
        this.tool = cmd.toLowerCase()
        this.cb.onSessionStart?.(this.tool)
        this.writeBanner()
        return
      case 'exit':
        this.cb.out('退出终端。\r\n')
        this.cb.onSessionEnd?.()
        return
      default:
        this.cb.out(`"${cmd}" 不是内部或外部命令，也不是可运行的程序或批处理文件。\r\n`)
    }
    this.writePrompt()
  }

  private handleAi(line: string) {
    if (!line) {
      this.cb.out(`${C.dim}>${C.reset} `)
      return
    }
    if (line === '/exit' || line === '/quit') {
      this.mode = 'shell'
      this.cb.onSessionEnd?.()
      this.writePrompt()
      return
    }
    if (line === '/help') {
      this.cb.out('/exit 退出会话 · /help 帮助\r\n')
      this.cb.out(`${C.dim}>${C.reset} `)
      return
    }
    this.cb.out(`${C.dim}└${C.reset} `)
    this.cb.out(this.cannedReply(line) + '\r\n')
    this.cb.out(`${C.dim}>${C.reset} `)
  }

  private cannedReply(q: string): string {
    const s = q.toLowerCase()
    if (s.includes('重构') || s.includes('refactor'))
      return '好的，我会先梳理当前模块结构，再拆分职责。建议从入口文件 app.tsx 看起。'
    if (s.includes('你好') || s.includes('hello') || s.includes('hi'))
      return '你好！我是演示模式的 AI 助手。真实环境会连接到 Claude Code。'
    if (s.includes('乱码') || s.includes('编码') || s.includes('encoding'))
      return 'PowerShell 中文乱码：执行 $OutputEncoding = [System.Text.Encoding]::UTF8 即可。'
    if (s.includes('readme') || s.includes('文档'))
      return '我可以帮你生成 README，先告诉我项目的主要功能与安装方式。'
    return `（演示回复）我收到："${q}"。真实环境中此处调用 ${this.tool ?? 'AI Agent'}。`
  }

  resize(_cols: number, _rows: number) {
    // mock 无需处理
  }

  dispose() {
    this.cb.onSessionEnd?.()
  }
}
