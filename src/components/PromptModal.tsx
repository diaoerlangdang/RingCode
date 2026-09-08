import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/useAppStore'

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface-2)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius)',
  padding: '8px 10px',
  color: 'var(--text)',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
}

/** 自定义 prompt 对话框：Electron 渲染层 window.prompt 失效（返回 null），用此 Promise 化组件替代 */
export function PromptModal() {
  const d = useAppStore((s) => s.promptDialog)
  const resolvePrompt = useAppStore((s) => s.resolvePrompt)
  const [val, setVal] = useState('')

  useEffect(() => {
    setVal(d?.defaultValue ?? '')
  }, [d])

  if (!d) return null
  const submit = () => resolvePrompt(val)
  const cancel = () => resolvePrompt(null)

  return (
    <div className="modal-overlay" onClick={cancel}>
      <div className="modal" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-2)' }}>{d.message}</div>
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            else if (e.key === 'Escape') cancel()
          }}
          style={inputStyle}
        />
        <div className="modal-actions">
          <button className="btn" onClick={cancel}>
            取消
          </button>
          <button className="btn primary" onClick={submit}>
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
