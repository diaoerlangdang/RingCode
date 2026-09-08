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
createRoot(document.getElementById('root')!).render(<App />)

