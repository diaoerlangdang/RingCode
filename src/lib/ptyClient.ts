// 渲染层 PTY 管理器：把终端标签映射到主进程 node-pty 进程，双向流转数据。
// 仅在 Electron 环境可用；web 下 isReal=false，TerminalView 回退 MockPty。

export interface SpawnOpts {
  exe: string
  args: string[]
  cwd: string
  env?: Record<string, string>
  cols: number
  rows: number
  credentialRef?: string
  sensitiveEnvKeys?: string[]
}

type DataCb = (tabId: string, data: string) => void
type ExitCb = (tabId: string, code: number) => void

class PtyClient {
  private tabToPty = new Map<string, string>()
  private ptyToTab = new Map<string, string>()
  /** 每次 spawn/dispose 递增，用来丢掉 StrictMode / HMR 下过期的 in-flight spawn */
  private generations = new Map<string, number>()
  private dataCbs = new Set<DataCb>()
  private exitCbs = new Set<ExitCb>()
  private ready = false

  constructor() {
    const api = typeof window !== 'undefined' ? window.ringcode : undefined
    if (!api?.isElectron) return
    api.onPtyData((ptyId, data) => {
      const tabId = this.ptyToTab.get(ptyId)
      if (tabId) this.dataCbs.forEach((cb) => cb(tabId, data))
    })
    api.onPtyExit((ptyId, code) => {
      const tabId = this.ptyToTab.get(ptyId)
      if (tabId) {
        this.exitCbs.forEach((cb) => cb(tabId, code))
        this.tabToPty.delete(tabId)
        this.ptyToTab.delete(ptyId)
      }
    })
    this.ready = true
  }

  get isReal(): boolean {
    return this.ready
  }

  private bump(tabId: string): number {
    const g = (this.generations.get(tabId) ?? 0) + 1
    this.generations.set(tabId, g)
    return g
  }

  async spawn(tabId: string, opts: SpawnOpts): Promise<string | null> {
    if (!this.ready) return null
    const gen = this.bump(tabId)
    const api = window.ringcode!
    const ptyId = await api.ptySpawn(opts)
    if (this.generations.get(tabId) !== gen) {
      api.ptyDispose(ptyId)
      return null
    }
    const prev = this.tabToPty.get(tabId)
    if (prev && prev !== ptyId) {
      api.ptyDispose(prev)
      this.ptyToTab.delete(prev)
    }
    this.tabToPty.set(tabId, ptyId)
    this.ptyToTab.set(ptyId, tabId)
    return ptyId
  }

  write(tabId: string, data: string): void {
    const ptyId = this.tabToPty.get(tabId)
    if (ptyId) window.ringcode!.ptyInput(ptyId, data)
  }

  resize(tabId: string, cols: number, rows: number): void {
    const ptyId = this.tabToPty.get(tabId)
    if (ptyId) window.ringcode!.ptyResize(ptyId, cols, rows)
  }

  dispose(tabId: string): void {
    this.bump(tabId)
    const ptyId = this.tabToPty.get(tabId)
    if (ptyId) {
      window.ringcode!.ptyDispose(ptyId)
      this.tabToPty.delete(tabId)
      this.ptyToTab.delete(ptyId)
    }
  }

  onData(cb: DataCb): () => void {
    this.dataCbs.add(cb)
    return () => {
      this.dataCbs.delete(cb)
    }
  }

  onExit(cb: ExitCb): () => void {
    this.exitCbs.add(cb)
    return () => {
      this.exitCbs.delete(cb)
    }
  }
}

export const ptyClient = new PtyClient()
