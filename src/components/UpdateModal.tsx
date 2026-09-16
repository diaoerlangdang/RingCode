import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import {
  APP_UPDATE_AVAILABLE_EVENT,
  APP_UPDATE_CHECK_INTERVAL_MS,
  shouldShowAutomaticUpdate,
  type AppUpdateResult,
} from '@/lib/appUpdateEvents'

type UpdatePhase = 'ready' | 'downloading' | 'installing' | 'error'

function formatReleaseDate(raw: string | null): string | null {
  if (!raw) return null
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
}

export function UpdateModal() {
  const patchSettings = useAppStore((state) => state.patchSettings)
  const showToast = useAppStore((state) => state.showToast)
  const checking = useRef(false)
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<AppUpdateResult | null>(null)
  const [phase, setPhase] = useState<UpdatePhase>('ready')
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const releaseDate = useMemo(() => formatReleaseDate(result?.publishedAt ?? null), [result?.publishedAt])

  useEffect(() => {
    const api = window.ringcode
    if (!api?.checkAppUpdate) return
    let alive = true

    const show = (next: AppUpdateResult) => {
      if (!alive || !next.newer || !next.latestVersion) return
      setResult(next)
      setPhase('ready')
      setProgress(0)
      setStatus('')
      setOpen(true)
    }

    const checkAutomatically = async () => {
      if (checking.current) return
      checking.current = true
      try {
        const next = await api.checkAppUpdate(false)
        const settings = useAppStore.getState().settings
        if (shouldShowAutomaticUpdate(next, settings.updateDismissedVersion, settings.updateDismissedAt)) show(next)
      } catch {
        // 自动检查失败不打扰用户；设置中的手动检查会显示具体错误。
      } finally {
        checking.current = false
      }
    }

    const onAvailable = (event: Event) => show((event as CustomEvent<AppUpdateResult>).detail)
    const offProgress = api.onUpdateProgress?.((payload) => {
      if (!alive) return
      setPhase(payload.phase)
      setStatus(payload.message)
      if (typeof payload.percent === 'number') setProgress(payload.percent)
    })
    window.addEventListener(APP_UPDATE_AVAILABLE_EVENT, onAvailable)
    const initialTimer = window.setTimeout(() => void checkAutomatically(), 8000)
    const intervalTimer = window.setInterval(() => void checkAutomatically(), APP_UPDATE_CHECK_INTERVAL_MS)
    return () => {
      alive = false
      window.clearTimeout(initialTimer)
      window.clearInterval(intervalTimer)
      window.removeEventListener(APP_UPDATE_AVAILABLE_EVENT, onAvailable)
      offProgress?.()
    }
  }, [])

  useEffect(() => {
    if (!open || phase === 'downloading' || phase === 'installing') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, phase, result?.latestVersion])

  if (!open || !result) return null
  const busy = phase === 'downloading' || phase === 'installing'
  const canInstall = !!result.downloadUrl

  function close() {
    if (busy) return
    if (result?.latestVersion) patchSettings({ updateDismissedVersion: result.latestVersion, updateDismissedAt: Date.now() })
    setOpen(false)
  }

  async function install() {
    const api = window.ringcode
    if (!api?.downloadAndInstallUpdate || !canInstall) return
    setPhase('downloading')
    setProgress(0)
    setStatus('正在准备下载…')
    try {
      const installed = await api.downloadAndInstallUpdate()
      if (!installed.ok) {
        setPhase('error')
        setStatus(installed.error || '下载安装失败，请重试')
        showToast(installed.error || '下载安装失败，请重试', 'error')
      }
    } catch {
      setPhase('error')
      setStatus('下载安装失败，请检查网络后重试')
      showToast('下载安装失败，请检查网络后重试', 'error')
    }
  }

  return (
    <div className="modal-overlay update-overlay" onClick={close}>
      <div
        className="modal update-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="update-modal-head">
          <div>
            <div className="update-kicker">应用更新</div>
            <h3 id="update-modal-title">发现新版本 v{result.latestVersion}</h3>
            <div className="update-meta">
              当前 v{result.currentVersion}
              {releaseDate ? ` · 发布于 ${releaseDate}` : ''}
            </div>
          </div>
          {!busy && (
            <button className="update-close" aria-label="稍后提醒" onClick={close}>
              ×
            </button>
          )}
        </div>

        <div className="update-notes" aria-label="更新内容">
          <div className="update-notes-title">{result.releaseName || '本次更新内容'}</div>
          <pre>{result.releaseNotes || '本次发布未填写更新说明。'}</pre>
        </div>

        {result.channel === 'portable' && phase === 'ready' && (
          <div className="update-hint">免安装版升级将启动标准安装程序；下载过程不会打开浏览器。</div>
        )}

        {(phase === 'downloading' || phase === 'installing') && (
          <div className="update-progress" aria-live="polite">
            <div className="update-progress-row">
              <span>{status}</span>
              <span>{progress > 0 ? `${progress}%` : ''}</span>
            </div>
            <div className="update-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <div style={{ width: `${progress}%` }} />
            </div>
            {phase === 'installing' && <div className="update-hint">安装程序启动后，RingCode 将自动退出。</div>}
          </div>
        )}

        {phase === 'error' && <div className="update-error" role="alert">{status}</div>}
        {!canInstall && <div className="update-error">当前 Release 暂未上传 Windows 安装包，请稍后再试。</div>}

        <div className="modal-actions update-actions">
          {!busy && <button className="btn" onClick={close}>稍后提醒</button>}
          <button className="btn primary" disabled={busy || !canInstall} onClick={() => void install()} autoFocus={canInstall}>
            {phase === 'downloading' ? '正在下载…' : phase === 'installing' ? '正在启动安装…' : phase === 'error' ? '重试升级' : '立即升级'}
          </button>
        </div>
      </div>
    </div>
  )
}
