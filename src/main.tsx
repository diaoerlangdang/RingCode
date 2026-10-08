import { createRoot } from 'react-dom/client'
import App from './App'
import './lib/monacoSetup'
import './styles/tokens.css'
import './styles/base.css'
import './styles/app.css'
import { useAppStore } from './store/useAppStore'
import { useEditorStore } from './store/useEditorStore'
import { useFsStore } from './store/useFsStore'

if (typeof window !== 'undefined') {
  ;(window as any).__appStore = useAppStore
  ;(window as any).__editorStore = useEditorStore
  ;(window as any).__fsStore = useFsStore
}

// TerminalView 持有 xterm、ResizeObserver 和真实 PTY 等命令式资源。
// React StrictMode 在开发环境执行 effect 的 setup → cleanup → setup，会让 xterm
// 在 open 后立刻 dispose，其内部延迟的 viewport 回调随后访问已销毁的 dimensions。
const container = document.getElementById('root')!
const mountApp = () => createRoot(container).render(<App />)

// SQLite 快照及独立会话正文异步加载；首启向导等 effect 会持久化状态。
// 加载完成前挂载 App 会把已有历史、工作区和分身覆盖成默认空状态。
if (useAppStore.persist.hasHydrated()) {
  mountApp()
} else {
  container.textContent = '正在读取本地数据…'
  const unsubscribe = useAppStore.persist.onFinishHydration(() => {
    unsubscribe()
    mountApp()
  })
}
