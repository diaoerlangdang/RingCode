import { useEffect, useState } from 'react'
import { cleanUnusedImages } from '@/lib/attachments'
import { useAppStore } from '@/store/useAppStore'

export function AttachmentCacheSettings() {
  const [stats, setStats] = useState<{ bytes: number; unusedBytes: number; count: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const read = async () => {
    try { setStats(await window.ringcode!.attachmentStats()); setError('') }
    catch { setError('无法读取图片缓存') }
  }
  useEffect(() => { if (window.ringcode?.attachmentStats) void read() }, [])
  if (!window.ringcode?.attachmentStats) return null
  const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return <div className="settings-row">
    <div>
      <div className="label">会话图片缓存</div>
      <div className="desc">{error || (stats ? `${stats.count} 张 · ${mb(stats.bytes)} · 无引用 ${mb(stats.unusedBytes)}` : '正在读取…')}</div>
      <div className="desc">保留草稿和会话图片；无引用副本经过 24 小时宽限期后清理。</div>
    </div>
    <button type="button" className="btn" disabled={busy} onClick={async () => {
      setBusy(true)
      try {
        await cleanUnusedImages()
        await read()
        useAppStore.getState().showToast('已检查并清理无引用图片缓存', 'success')
      } catch (error) { useAppStore.getState().showToast(String(error), 'error') }
      finally { setBusy(false) }
    }}>{busy ? '清理中…' : '清理无引用缓存'}</button>
  </div>
}
