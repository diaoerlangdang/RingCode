import { useAppStore } from '@/store/useAppStore'
import { TerminalView } from './TerminalView'

export function TerminalPane() {
  const terminals = useAppStore((s) => s.terminals)
  const activeTerminalId = useAppStore((s) => s.activeTerminalId)
  const setActiveTerminal = useAppStore((s) => s.setActiveTerminal)
  const closeTerminal = useAppStore((s) => s.closeTerminal)
  const newTerminal = useAppStore((s) => s.newTerminal)
  const renameTerminal = useAppStore((s) => s.renameTerminal)
  const showToast = useAppStore((s) => s.showToast)
  const showConfirm = useAppStore((s) => s.showConfirm)
  const showPrompt = useAppStore((s) => s.showPrompt)
  const layout = useAppStore((s) => s.layout)
  const setLayout = useAppStore((s) => s.setLayout)
  const splitTerminalId = useAppStore((s) => s.splitTerminalId)
  const setSplitTerminal = useAppStore((s) => s.setSplitTerminal)
  const shellExe = useAppStore((s) => s.settings.shellExe)

  const onClose = async (id: string, title: string) => {
    const t = terminals.find((x) => x.id === id)
    if (t?.kind === 'ai' && !t.orphaned && !(await showConfirm(`关闭「${title}」？正在运行的 AI 会话将被终止。`))) return
    closeTerminal(id)
  }

  const renameTab = async (id: string, title: string) => {
    const n = await showPrompt('重命名终端', title)
    if (n && n.trim()) renameTerminal(id, n.trim())
  }

  const toggleSplit = () => {
    if (layout.terminalSplit) {
      setLayout({ terminalSplit: false })
      setSplitTerminal(null)
      return
    }
    const other = terminals.find((t) => t.id !== activeTerminalId)
    if (!other) {
      const id = newTerminal('shell', { title: (shellExe || 'powershell.exe').replace(/\.exe$/i, '') })
      setSplitTerminal(id)
    } else {
      setSplitTerminal(other.id)
    }
    setLayout({ terminalSplit: true })
  }

  const splitOn = !!layout.terminalSplit && !!splitTerminalId && splitTerminalId !== activeTerminalId

  return (
    <>
      <div className="pane-tabs">
        {terminals.map((t) => (
          <div
            key={t.id}
            className={`tab ${t.id === activeTerminalId ? 'active' : ''} ${t.id === splitTerminalId && splitOn ? 'split-mark' : ''}`}
            onClick={() => {
              if (splitOn && t.id !== activeTerminalId) {
                setSplitTerminal(t.id)
                return
              }
              setActiveTerminal(t.id)
            }}
            onDoubleClick={() => renameTab(t.id, t.title)}
            title="单击切换 · 双击重命名"
          >
            {t.kind === 'ai' && <span className="dot-run" />}
            {t.title}
            <span
              className="close"
              onClick={(e) => {
                e.stopPropagation()
                onClose(t.id, t.title)
              }}
            >
              ×
            </span>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div className="tab" title="终端分屏" onClick={toggleSplit}>
          {splitOn ? '合并' : '分屏'}
        </div>
        <div
          className="tab"
          title="新建终端"
          onClick={() => {
            newTerminal('shell', { title: (shellExe || 'powershell.exe').replace(/\.exe$/i, '') })
            showToast('已新建终端', 'info')
          }}
        >
          +
        </div>
      </div>
      <div className="pane-body">
        <div className={`terminal-wrap${splitOn ? ' terminal-split' : ''}`}>
          {terminals.map((t) => {
            const isLeft = t.id === activeTerminalId
            const isRight = splitOn && t.id === splitTerminalId
            const show = splitOn ? isLeft || isRight : t.id === activeTerminalId
            return (
              <div
                key={t.id}
                style={{
                  display: show ? 'block' : 'none',
                  width: splitOn && (isLeft || isRight) ? '50%' : '100%',
                  height: '100%',
                  order: isRight ? 2 : 1,
                }}
              >
                <TerminalView terminal={t} active={isLeft || isRight} />
              </div>
            )
          })}
          {terminals.length === 0 && (
            <div className="empty-state">
              <div className="emoji">▢</div>
              <div>没有终端</div>
              <div style={{ fontSize: 11 }}>点击 + 新建，或从顶部启动已集成的 Agent</div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
