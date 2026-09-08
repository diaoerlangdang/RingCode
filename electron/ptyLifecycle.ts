export interface ResizablePty {
  resize(cols: number, rows: number): void
}

type ScheduleAfterData = (run: () => void) => void

/**
 * Windows node-pty 会把 ready 前的 resize 延迟执行；若子进程先退出，延迟回调会在
 * node-pty 自己的 socket 事件中抛出，调用处的 try/catch 无法捕获。这里在主进程
 * 持有最后一次尺寸，直到 node-pty 已经成功派发首个 data 事件后再调用 resize。
 */
export class PtyResizeGate {
  private ready = false
  private readyScheduled = false
  private exited = false
  private pending: { cols: number; rows: number } | null = null

  constructor(
    private readonly pty: ResizablePty,
    private readonly scheduleAfterData: ScheduleAfterData = (run) => setImmediate(run),
  ) {}

  resize(cols: number, rows: number): void {
    if (this.exited || !Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) return
    const size = { cols: Math.floor(cols), rows: Math.floor(rows) }
    if (!this.ready) {
      this.pending = size
      return
    }
    this.apply(size)
  }

  onData(): void {
    if (this.ready || this.readyScheduled || this.exited) return
    this.readyScheduled = true
    // node-pty 自己也监听首个 socket data，并在该事件中把 _isReady 置为 true。
    // 应用层 onData 可能先执行，因此必须等当前事件的全部监听器完成后再 resize。
    this.scheduleAfterData(() => {
      this.readyScheduled = false
      if (this.exited) return
      this.ready = true
      const pending = this.pending
      this.pending = null
      if (pending) this.apply(pending)
    })
  }

  markExited(): void {
    this.exited = true
    this.readyScheduled = false
    this.pending = null
  }

  private apply(size: { cols: number; rows: number }): void {
    try {
      this.pty.resize(size.cols, size.rows)
    } catch {
      // ready 与 exit 仍可能在相邻事件间竞争；同步异常不应越过 IPC 边界。
    }
  }
}
