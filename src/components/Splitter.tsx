import { useCallback, useRef } from 'react'

interface SplitterProps {
  /** vertical = 竖线，左右拖拽改宽度；horizontal = 横线，上下拖拽改高度 */
  direction: 'vertical' | 'horizontal'
  /** 拖拽中（已用 RAF 合并），做最廉价的事：直接改 DOM，不要触发 React state */
  onResize: (delta: number) => void
  /** 松手时把最终值提交到 store */
  onResizeEnd?: () => void
  onDoubleClick?: () => void
}

/**
 * 可拖拽分隔条。
 * 性能要点：
 *  - setPointerCapture 捕获指针：拖拽经过 Monaco/xterm 等 iframe/canvas 也不丢事件；
 *  - requestAnimationFrame 合并 pointermove，一帧只派发一次 delta；
 *  - 拖拽中只让父组件改 DOM 宽/高（不进 React state、不写 localStorage），松手才提交 store。
 */
export function Splitter({ direction, onResize, onResizeEnd, onDoubleClick }: SplitterProps) {
  const rafRef = useRef<number | null>(null)
  const accRef = useRef(0)
  const lastRef = useRef(0)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return // 仅左键
      e.preventDefault()
      const isV = direction === 'vertical'
      lastRef.current = isV ? e.clientX : e.clientY
      accRef.current = 0

      const el = e.currentTarget as HTMLElement
      el.setPointerCapture(e.pointerId)
      document.body.style.cursor = isV ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'

      const flush = () => {
        rafRef.current = null
        if (accRef.current !== 0) {
          onResize(accRef.current)
          accRef.current = 0
        }
      }

      const move = (ev: PointerEvent) => {
        const cur = isV ? ev.clientX : ev.clientY
        const d = cur - lastRef.current
        lastRef.current = cur
        if (d !== 0) {
          accRef.current += d
          if (rafRef.current == null) rafRef.current = requestAnimationFrame(flush)
        }
      }
      const finish = (ev: PointerEvent) => {
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
        if (accRef.current !== 0) {
          onResize(accRef.current)
          accRef.current = 0
        }
        try {
          el.releasePointerCapture(ev.pointerId)
        } catch {
          /* 已释放 */
        }
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', finish)
        el.removeEventListener('pointercancel', finish)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        onResizeEnd?.()
      }

      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', finish)
      el.addEventListener('pointercancel', finish)
    },
    [direction, onResize, onResizeEnd],
  )

  return (
    <div
      className="splitter"
      data-dir={direction}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      role="separator"
      aria-orientation={direction === 'vertical' ? 'vertical' : 'horizontal'}
    />
  )
}
