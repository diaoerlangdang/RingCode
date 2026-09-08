import { describe, expect, it } from 'vitest'
import { cleanTitleText, cleanTranscript, deriveTitle, displaySnippet, displayTitle, stripAnsi } from './sessionText'

describe('stripAnsi / cleanTranscript', () => {
  it('保留中文，去掉 CSI 颜色', () => {
    expect(stripAnsi('\x1b[32m你好世界\x1b[0m')).toBe('你好世界')
    expect(cleanTranscript('\x1b[1;38;5;81m启动会话\x1b[0m')).toBe('启动会话')
  })

  it('去掉 OSC 窗口标题和超链接包裹，留下可见文字', () => {
    expect(stripAnsi('\x1b]0;claude\x07hello')).toBe('hello')
    expect(stripAnsi('\x1b]8;;https://ex.com\x07链接\x1b]8;;\x07')).toBe('链接')
  })

  it('回车覆盖进度条，只留最后一帧', () => {
    expect(cleanTranscript('progress 10%\rprogress 100%')).toBe('progress 100%')
  })

  it('退格生效', () => {
    expect(cleanTranscript('helloz\b')).toBe('hello')
  })

  it('丢掉以框线为主的 TUI 装饰行，保留正文', () => {
    const raw = [
      '╭──────────────────╮',
      '│ 请问如何启动？     │',
      '╰──────────────────╯',
      '\x1b[?25l\x1b[2J你好，我是 Claude',
    ].join('\n')
    const out = cleanTranscript(raw)
    expect(out).toContain('你好，我是 Claude')
    expect(out).not.toMatch(/╭|╰|─{3,}/)
  })

  it('去掉 RingCode 进程状态行', () => {
    expect(cleanTranscript('有效正文\n\x1b[31m[进程已退出，代码 1]\x1b[0m')).toBe('有效正文')
  })

  it('空输入', () => {
    expect(cleanTranscript('')).toBe('')
    expect(stripAnsi('')).toBe('')
  })
})

describe('deriveTitle / displayTitle', () => {
  it('从带 ANSI 的用户问题抽出标题', () => {
    const t = deriveTitle('\x1b[?25l\x1b[2J\x1b[32m> 帮我解释这段代码\x1b[0m\n')
    expect(t).toBe('帮我解释这段代码')
  })

  it('旧标题含 ESC 时回退到正文', () => {
    expect(displayTitle('\x1b[32m??\x1b[0m', '\x1b[0m帮我写一个排序函数\n')).toBe('帮我写一个排序函数')
  })

  it('清理标题首尾的提示符、Markdown 和框线字符', () => {
    expect(cleanTitleText('│ ❯ **帮我修复登录问题** │')).toBe('帮我修复登录问题')
    expect(displayTitle('╭─ # 分析构建失败 ─╮')).toBe('分析构建失败')
  })

  it('噪声标题回退到正文中的有效用户文本', () => {
    expect(displayTitle('■■ E:\\work\\demo', 'C:\\work\\demo\n│ 请帮我检查登录逻辑 │')).toBe('请帮我检查登录逻辑')
    expect(displayTitle('mode normal d0c81cd4-3ebe-4ab2', '> 分析恢复失败原因')).toBe('分析恢复失败原因')
    expect(displayTitle('Claude Code v2.1.234')).toBe('未命名会话')
    expect(displayTitle('Waiting for API response · will retry in…')).toBe('未命名会话')
    expect(displayTitle('<EXTREMELY_IMPORTANT> You have superpowers.')).toBe('未命名会话')
    expect(displayTitle('{"hookSpecificOutput":true}')).toBe('未命名会话')
  })

  it('snippet 取可读首行', () => {
    expect(displaySnippet('\x1b[2J\n\n  第一句有效内容在这里  \n第二行')).toBe('第一句有效内容在这里')
  })
})
