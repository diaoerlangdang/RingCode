import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '@/store/useAppStore'
import { cleanUnusedImages, emptyTerminalDraft, importImageFiles, type ImageAttachment } from '@/lib/attachments'

function ImageChip({ image, disabled, remove }: { image: ImageAttachment; disabled: boolean; remove: () => void }) {
  const [url, setUrl] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let canceled = false
    void window.ringcode?.attachmentRead(image.id).then((result) => {
      if (!canceled) setUrl(result.dataUrl)
    }).catch(() => { if (!canceled) setFailed(true) })
    return () => { canceled = true }
  }, [image.id])
  return <div className="composer-image">
    <button type="button" disabled={!url} onClick={() => setExpanded(true)} title={`查看 ${image.name}`}>
      {url ? <img src={url} alt={image.name} /> : <span>{failed ? '图片缺失' : '读取中…'}</span>}
    </button>
    <button type="button" className="composer-image-remove" disabled={disabled} onClick={remove} aria-label={`移除 ${image.name}`}>×</button>
    {expanded && createPortal(<div className="composer-image-dialog" role="dialog" aria-modal="true" aria-label={image.name} onKeyDown={(e) => {
      if (e.key === 'Escape') { e.stopPropagation(); setExpanded(false) }
    }} onClick={() => setExpanded(false)}>
      <button type="button" autoFocus className="btn" onClick={() => setExpanded(false)}>关闭图片</button>
      <img src={url} alt={image.name} onClick={(e) => e.stopPropagation()} />
    </div>, document.body)}
  </div>
}

export function TerminalComposer({ id, sessionId, inputRef, nativeMode, menuMode, toggleNative, send, interrupt, latest, disabled }: {
  id: string; sessionId?: string; inputRef: React.RefObject<HTMLTextAreaElement>
  nativeMode: boolean; menuMode: boolean; toggleNative: () => void
  send: (text: string, images: ImageAttachment[]) => Promise<boolean>
  interrupt: () => void; latest: () => void; disabled: boolean
}) {
  const draft = useAppStore((s) => s.terminalDrafts[id] ?? emptyTerminalDraft)
  const [sending, setSending] = useState(false)
  const [adding, setAdding] = useState(false)
  const sendingRef = useRef(false)
  const composing = useRef(false)
  const blocked = disabled || nativeMode || menuMode || sending || adding
  const update = (text: string) => {
    const st = useAppStore.getState()
    st.setTerminalDraft(id, { ...(st.terminalDrafts[id] ?? emptyTerminalDraft), text })
  }
  const report = (error: unknown) => useAppStore.getState().showToast(error instanceof Error ? error.message : String(error), 'error')
  const add = async (load: () => Promise<ImageAttachment[]>) => {
    setAdding(true)
    try {
      const images = await load()
      const st = useAppStore.getState()
      if (!st.terminals.some((t) => t.id === id && t.sessionId === sessionId)) {
        await cleanUnusedImages(images.map((image) => image.id))
        return
      }
      const current = st.terminalDrafts[id] ?? emptyTerminalDraft
      st.setTerminalDraft(id, { ...current, images: [...current.images, ...images] })
    } catch (error) { report(error) } finally { setAdding(false) }
  }
  const submit = async () => {
    if (blocked || sendingRef.current || (!draft.text.trim() && !draft.images.length)) return
    sendingRef.current = true
    setSending(true)
    try {
      if (await send(draft.text, draft.images)) {
        const st = useAppStore.getState()
        const current = st.terminalDrafts[id] ?? emptyTerminalDraft
        // A path inserted by another panel while sending must not be lost.
        st.setTerminalDraft(id, {
          text: current.text === draft.text ? '' : current.text,
          images: current.images.filter((image) => !draft.images.some((sent) => sent.id === image.id)),
        })
      }
    } catch (error) { report(error) } finally { sendingRef.current = false; setSending(false) }
  }
  const insert = (text: string) => {
    const el = inputRef.current
    const start = el?.selectionStart ?? draft.text.length, end = el?.selectionEnd ?? start
    update(draft.text.slice(0, start) + text + draft.text.slice(end))
  }
  return <div className="terminal-composer" data-terminal-id={id}
    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy' }}
    onDrop={(e) => {
      e.preventDefault(); e.stopPropagation()
      if (blocked) return
      const files = Array.from(e.dataTransfer.files)
      if (files.length) void add(() => importImageFiles(files))
      else insert(e.dataTransfer.getData('application/x-ringcode-path') || e.dataTransfer.getData('text/plain'))
    }}>
    <div className="composer-toolbar">
      <button type="button" className={`btn ${nativeMode ? 'primary' : ''}`} onClick={toggleNative} disabled={sending}>
        {nativeMode ? '返回底部输入框' : menuMode ? '操作 CLI 菜单' : '原生终端操作'}
      </button>
      <button type="button" className="btn" onClick={latest}>回到最新</button>
      <button type="button" className="btn" onClick={interrupt} disabled={disabled || sending} title="发送一次 Esc；取消当前响应或关闭当前菜单">中断任务</button>
      <span className={`composer-hint${menuMode ? ' composer-menu-hint' : ''}`} role={menuMode ? 'status' : undefined}>{nativeMode ? '原生按键已恢复；完成菜单操作并清空原输入后返回' : menuMode ? 'CLI 等待选择：方向键选择 · Enter 确认 · Esc 取消；草稿已保留' : 'Enter 发送 · Shift+Enter 换行 · Ctrl+C 复制'}</span>
    </div>
    <div style={{ display: nativeMode ? 'none' : undefined }}>
    {draft.images.length > 0 && <div className="composer-images">{draft.images.map((image) => <ImageChip key={image.id} image={image} disabled={sending || adding} remove={() => {
      const st = useAppStore.getState(), current = st.terminalDrafts[id] ?? emptyTerminalDraft
      st.setTerminalDraft(id, { ...current, images: current.images.filter((item) => item.id !== image.id) })
      void cleanUnusedImages([image.id]).catch(report)
    }} />)}</div>}
    <textarea ref={inputRef} rows={3} aria-label="AI 会话输入" placeholder={nativeMode ? '正在使用原生终端，底部草稿会保留' : '输入问题，可粘贴或拖入图片…'}
      value={draft.text} disabled={blocked} onChange={(e) => update(e.target.value)}
      onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !composing.current && !e.nativeEvent.isComposing && e.keyCode !== 229) {
          e.preventDefault(); void submit()
        }
      }}
      onPaste={(e) => {
        e.stopPropagation()
        const images = Array.from(e.clipboardData.files).filter((file) => file.type.startsWith('image/'))
        if (images.length) {
          e.preventDefault()
          const text = e.clipboardData.getData('text/plain')
          if (text) insert(text)
          void add(() => importImageFiles(images))
        } else if (!e.clipboardData.getData('text/plain') && window.ringcode?.attachmentClipboard) {
          e.preventDefault()
          void add(async () => { const image = await window.ringcode!.attachmentClipboard(); return image ? [image] : [] })
        }
      }} />
    <div className="composer-actions">
      <button type="button" className="btn" disabled={blocked || !window.ringcode?.attachmentChoose} onClick={() => void add(() => window.ringcode!.attachmentChoose())}>添加图片</button>
      <span className="composer-hint">{adding ? '正在保存图片…' : 'PNG / JPEG · 每张 ≤ 10 MB'}</span>
      <button type="button" className="btn primary" disabled={blocked || (!draft.text.trim() && !draft.images.length)} onClick={() => void submit()}>{sending ? '正在发送…' : '发送'}</button>
    </div>
    </div>
  </div>
}
