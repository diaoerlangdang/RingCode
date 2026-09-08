import { describe, expect, it } from 'vitest'
import { PtyResizeGate } from './ptyLifecycle'

class DeferredWindowsPty {
  exited = false
  ready = false
  resizeCalls: Array<[number, number]> = []
  private deferred: Array<() => void> = []

  resize(cols: number, rows: number): void {
    const run = () => {
      if (this.exited) throw new Error('Cannot resize a pty that has already exited')
      this.resizeCalls.push([cols, rows])
    }
    if (this.ready) run()
    else this.deferred.push(run)
  }

  flushReady(): void {
    this.ready = true
    for (const run of this.deferred.splice(0)) run()
  }
}

describe('PtyResizeGate', () => {
  it('PTY 在 ready 前退出时不把 resize 排进 node-pty 队列', () => {
    const pty = new DeferredWindowsPty()
    const scheduled: Array<() => void> = []
    const gate = new PtyResizeGate(pty, (run) => scheduled.push(run))

    gate.resize(100, 30)
    gate.onData()
    pty.exited = true
    gate.markExited()
    for (const run of scheduled) run()

    expect(() => pty.flushReady()).not.toThrow()
    expect(pty.resizeCalls).toEqual([])
  })

  it('等当前 data 事件结束、node-pty 内部 ready 后才刷新最后一次尺寸', () => {
    const pty = new DeferredWindowsPty()
    const scheduled: Array<() => void> = []
    const gate = new PtyResizeGate(pty, (run) => scheduled.push(run))

    gate.resize(90, 20)
    gate.resize(120, 40)
    gate.onData()
    expect(pty.resizeCalls).toEqual([])
    expect(scheduled).toHaveLength(1)

    pty.ready = true
    for (const run of scheduled) run()
    gate.resize(121, 41)
    gate.markExited()
    pty.exited = true
    gate.resize(122, 42)

    expect(pty.resizeCalls).toEqual([[120, 40], [121, 41]])
  })
})
