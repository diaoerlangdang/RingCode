import { useAppStore } from '@/store/useAppStore'

/** 自定义 confirm 对话框：Electron 渲染层 window.confirm 不可靠，用此 Promise 化组件替代 */
export function ConfirmModal() {
  const d = useAppStore((s) => s.confirmDialog)
  const resolveConfirm = useAppStore((s) => s.resolveConfirm)
  if (!d) return null
  const cancel = () => resolveConfirm(false)
  const ok = () => resolveConfirm(true)
  return (
    <div className="modal-overlay" onClick={cancel}>
      <div className="modal" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{d.message}</div>
        <div className="modal-actions">
          <button className="btn" onClick={cancel}>
            取消
          </button>
          <button className="btn primary" onClick={ok} autoFocus>
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
