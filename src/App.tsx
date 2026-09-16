import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { useFsStore } from '@/store/useFsStore'
import { useEditorStore } from '@/store/useEditorStore'
import { syncChangedOpenFiles, type FsChangePayload } from '@/lib/editorFileSync'
import { useShortcuts } from '@/hooks/useShortcuts'
import { Splitter } from '@/components/Splitter'
import { TopBar } from '@/components/TopBar'
import { LeftNav } from '@/components/LeftNav'
import { CenterPane } from '@/components/CenterPane'
import { RightPanel } from '@/components/RightPanel'
import { CommandPalette } from '@/components/CommandPalette'
import { SettingsModal } from '@/components/SettingsModal'
import { FirstRunWizard } from '@/components/FirstRunWizard'
import { PromptModal } from '@/components/PromptModal'
import { ConfirmModal } from '@/components/ConfirmModal'
import { UpdateModal } from '@/components/UpdateModal'
import { ToastStack } from '@/components/Toast'
import { isDriveRoot } from '@/lib/pathWin'

export default function App() {
  useShortcuts()
  const layout = useAppStore((s) => s.layout)
  const setLayout = useAppStore((s) => s.setLayout)
  const theme = useAppStore((s) => s.settings.theme)
  const workspaces = useAppStore((s) => s.workspaces)
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const workspaceRootsKey = workspaces.map((w) => w.path).join('|')
  const activeWsPath = workspaces.find((w) => w.id === activeWorkspaceId)?.path ?? ''

  // 拖拽期间直接改 DOM 宽度（不进 React state、不写 localStorage），松手才提交 store。
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const leftW = useRef(layout.leftWidth)
  const rightW = useRef(layout.rightWidth)
  leftW.current = layout.leftWidth
  rightW.current = layout.rightWidth

  // 主题应用：data-theme 切换 token，组件无感知（UI-008）
  useEffect(() => {
    const apply = () => {
      const resolved =
        theme === 'system'
          ? window.matchMedia('(prefers-color-scheme: light)').matches
            ? 'light'
            : 'dark'
          : theme
      document.documentElement.setAttribute('data-theme', resolved)
    }
    apply()
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: light)')
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [theme])

  // 工作区根目录登记 + 文件监听（§9.3 / FIL-007）
  // 盘符根（如 D:\）禁止 recursive watch，否则整盘事件会把文件管理器刷死
  useEffect(() => {
    const api = window.ringcode
    if (!api?.isElectron) return
    const roots = workspaceRootsKey ? workspaceRootsKey.split('|').filter(Boolean) : []
    let off: (() => void) | undefined
    let cancelled = false
    void api.setWorkspaceRoots(roots).then(() => {
      if (cancelled || !api.fsWatch) return
      if (!activeWsPath || isDriveRoot(activeWsPath)) return
      return api.fsWatch(activeWsPath).then(() => {
        if (cancelled) return
        off = api.onFsChanged?.((payload) => {
          window.dispatchEvent(new CustomEvent('ringcode:fs-changed', { detail: payload }))
        })
      })
    })
    return () => {
      cancelled = true
      off?.()
      void api.fsUnwatch?.()
    }
  }, [workspaceRootsKey, activeWsPath])

  // 编辑器可能在切到“预览”后卸载；文件同步必须常驻 App，不能依赖 EditorPane 是否可见。
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const changes: FsChangePayload[] = []

    const flush = async () => {
      timer = undefined
      const pending = changes.splice(0)
      const editor = useEditorStore.getState()
      await syncChangedOpenFiles(editor.files, pending, {
        getCurrent: (id) => useEditorStore.getState().files.find((file) => file.id === id),
        reload: (id) => useEditorStore.getState().reloadFromDisk(id),
        markConflict: (id) => useEditorStore.getState().markConflict(id, true),
        notifyConflict: (name) =>
          useAppStore.getState().showToast(`磁盘上的 ${name} 已更新，已保留未保存编辑`, 'info'),
      })
    }

    const onFsChanged = (event: Event) => {
      const detail = (event as CustomEvent<FsChangePayload>).detail
      if (!detail?.rootPath) return
      changes.push(detail)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void flush(), 120)
    }

    window.addEventListener('ringcode:fs-changed', onFsChanged)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('ringcode:fs-changed', onFsChanged)
    }
  }, [])

  // 工作区切换时，把文件系统句柄同步到当前工作区真实磁盘路径（Electron）
  useEffect(() => {
    if (!window.ringcode?.isElectron) return
    const st = useAppStore.getState()
    const ws = st.workspaces.find((w) => w.id === st.activeWorkspaceId)
    if (ws?.path) {
      useFsStore.getState().setHandle({ kind: 'electron', rootPath: ws.path, name: ws.name }, ws.name)
    }
  }, [activeWorkspaceId])

  // 首启向导：仅 Electron、且未完成时自动弹出
  useEffect(() => {
    if (!window.ringcode?.isElectron) return
    const st = useAppStore.getState()
    if (!st.settings.firstRunDone) st.setWizardOpen(true)
  }, [])

  // 启动时以系统凭据库为准回填 credentialSet（CFG-003/006，§9.5）
  // 持久化里的 credentialSet 可能与凭据管理器实际状态不一致（如外部清除/迁移），此处权威校正
  useEffect(() => {
    const api = window.ringcode
    if (!api) return
    const st = useAppStore.getState()
    for (const p of st.profiles) {
      if (!p.credentialRef) continue
      const ref = p.credentialRef
      const cur = p.credentialSet
      api.credHas(ref).then((has) => {
        if (has !== cur) useAppStore.getState().upsertProfile({ ...p, credentialSet: !!has })
      })
    }
  }, [])

  const onLeftResize = (delta: number) => {
    const next = Math.min(350, Math.max(200, leftW.current + delta))
    leftW.current = next
    if (leftRef.current) leftRef.current.style.width = next + 'px'
  }
  const onLeftResizeEnd = () => setLayout({ leftWidth: leftW.current })

  const onRightResize = (delta: number) => {
    // 右栏在右侧，拖拽向右 => 右栏变窄
    const next = Math.min(400, Math.max(250, rightW.current - delta))
    rightW.current = next
    if (rightRef.current) rightRef.current.style.width = next + 'px'
  }
  const onRightResizeEnd = () => setLayout({ rightWidth: rightW.current })

  return (
    <div className="app">
      <TopBar />
      <div className="body">
        {!layout.leftHidden && (
          <>
            <div ref={leftRef} style={{ flexShrink: 0, width: layout.leftWidth }}>
              <LeftNav />
            </div>
            <Splitter direction="vertical" onResize={onLeftResize} onResizeEnd={onLeftResizeEnd} onDoubleClick={() => setLayout({ leftWidth: 250 })} />
          </>
        )}
        <CenterPane />
        {!layout.rightHidden && (
          <>
            <Splitter direction="vertical" onResize={onRightResize} onResizeEnd={onRightResizeEnd} onDoubleClick={() => setLayout({ rightWidth: 300 })} />
            <div ref={rightRef} style={{ flexShrink: 0, width: layout.rightWidth }}>
              <RightPanel />
            </div>
          </>
        )}
      </div>

      <CommandPalette />
      <SettingsModal />
      <FirstRunWizard />
      <PromptModal />
      <ConfirmModal />
      <UpdateModal />
      <ToastStack />
    </div>
  )
}
