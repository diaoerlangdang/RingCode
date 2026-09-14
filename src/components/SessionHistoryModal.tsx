import { useEffect, useRef, useState } from 'react'
import { CloneEntrySelect } from '@/components/CloneEntrySelect'
import { cleanTranscript } from '@/lib/sessionText'
import { historyFallbackText, messagesToText, parseHistoryMessages, type HistoryMessage } from '@/lib/sessionHistory'
import type { AgentDef, HistoryMatch, Session } from '@/types'

export type HistoryDetailTarget =
  | { kind: 'local'; session: Session; title: string; sourceTitle?: string }
  | { kind: 'disk'; match: HistoryMatch; title: string; linkedSession?: Session }

interface Props {
  target: HistoryDetailTarget
  canResume: boolean
  onClose: () => void
  onResume: () => void
  onBranch: () => void
  onRename: () => void
  entryHint?: string
  familyAgents?: AgentDef[]
  selectedEntryId?: string
  entrySelectDisabled?: boolean
  entrySelectDisabledReason?: string
  missingKey?: boolean
  onSelectEntry?: (id: string) => void
}

const ROLE_LABEL = {
  user: '用户',
  assistant: '助手',
  tool: '工具',
  system: '系统',
} as const

export function SessionHistoryModal({
  target,
  canResume,
  onClose,
  onResume,
  onBranch,
  onRename,
  entryHint,
  familyAgents,
  selectedEntryId,
  entrySelectDisabled,
  entrySelectDisabledReason,
  missingKey,
  onSelectEntry,
}: Props) {
  const [messages, setMessages] = useState<HistoryMessage[]>([])
  const [plainText, setPlainText] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [pageStart, setPageStart] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)

  const targetKind = target.kind
  const localSessionId = target.kind === 'local' ? target.session.id : ''
  const localTool = target.kind === 'local' ? target.session.family || target.session.tool : ''
  const localNativeId = target.kind === 'local' ? target.session.nativeSessionId ?? '' : ''
  const diskFile = target.kind === 'disk' ? target.match.sessionFile : ''
  const sourceKey = targetKind === 'disk'
    ? `disk:${diskFile}`
    : localNativeId
      ? `native:${localTool}:${localNativeId}`
      : `local:${localSessionId}`
  const sourceKeyRef = useRef(sourceKey)
  const fallbackTranscriptRef = useRef('')
  sourceKeyRef.current = sourceKey
  fallbackTranscriptRef.current = target.kind === 'local' ? target.session.transcript : ''

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    setQuery('')
    setCopied(false)
    setMessages([])
    setPlainText('')
    setPageStart(null)
    setHasMore(false)
    setLoadingOlder(false)

    if (targetKind === 'local' && !localNativeId) {
      setPlainText(cleanTranscript(fallbackTranscriptRef.current))
      setLoading(false)
      return
    }

    const api = window.ringcode
    setLoading(true)
    void (async () => {
      try {
        const page = targetKind === 'local'
          ? await api?.historyReadSessionPage?.(localTool, localNativeId)
          : await api?.historyReadFilePage?.(diskFile)
        if (cancelled) return
        if (!page) {
          setPlainText(
            targetKind === 'local'
              ? cleanTranscript(fallbackTranscriptRef.current)
              : target.kind === 'disk'
                ? target.match.snippet
                : '',
          )
          return
        }
        const parsed = parseHistoryMessages(page.content)
        setMessages(parsed)
        setPlainText(parsed.length ? '' : historyFallbackText(page.content))
        setPageStart(page.start)
        setHasMore(page.hasMore)
      } catch {
        if (!cancelled && targetKind === 'local') {
          setPlainText(cleanTranscript(fallbackTranscriptRef.current))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sourceKey])

  const loadOlder = async () => {
    if (!hasMore || pageStart === null || loadingOlder) return
    const requestKey = sourceKey
    setLoadingOlder(true)
    try {
      const api = window.ringcode
      const page = targetKind === 'local'
        ? await api?.historyReadSessionPage?.(localTool, localNativeId, pageStart)
        : await api?.historyReadFilePage?.(diskFile, pageStart)
      if (!page || sourceKeyRef.current !== requestKey) return
      const olderMessages = parseHistoryMessages(page.content)
      if (olderMessages.length) setMessages((current) => [...olderMessages, ...current])
      else {
        const olderText = historyFallbackText(page.content)
        if (olderText) setPlainText((current) => [olderText, current].filter(Boolean).join('\n\n'))
      }
      setPageStart(page.start)
      setHasMore(page.hasMore)
    } finally {
      if (sourceKeyRef.current === requestKey) setLoadingOlder(false)
    }
  }

  const normalizedQuery = query.trim().toLowerCase()
  const visibleMessages = normalizedQuery
    ? messages.filter((m) => m.text.toLowerCase().includes(normalizedQuery))
    : messages
  const visiblePlainText = !normalizedQuery || plainText.toLowerCase().includes(normalizedQuery) ? plainText : ''
  const title = target.title
  const tool = target.kind === 'local' ? target.session.tool : target.match.tool
  const cwd = target.kind === 'local' ? target.session.cwd : target.match.projectPath
  const sourceTitle = target.kind === 'local' ? target.sourceTitle : undefined
  const copyText = messages.length ? messagesToText(messages) : plainText

  const copyAll = async () => {
    if (!copyText) return
    try {
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1_500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="modal-overlay history-modal-overlay" onClick={onClose}>
      <div className="history-modal" role="dialog" aria-modal="true" aria-label={`会话详情：${title}`} onClick={(e) => e.stopPropagation()}>
        <div className="history-modal-head">
          <div style={{ minWidth: 0 }}>
            <h3 title={title}>{title}</h3>
            <div className="history-modal-meta">
              <span>{tool}</span>
              <span title={cwd}>{cwd || '未知工作目录'}</span>
              {sourceTitle ? <span>基于《{sourceTitle}》创建</span> : null}
              {entryHint ? <span>{entryHint}{missingKey ? ' · 待补配置' : ''}</span> : null}
            </div>
          </div>
          <button className="history-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="history-modal-toolbar">
          <div className="search-box history-search">
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={hasMore ? '搜索当前已加载内容' : '在会话中搜索'} autoFocus />
          </div>
          <button className="btn" onClick={copyAll} disabled={!copyText}>
            {copied ? '已复制' : hasMore ? '复制已加载正文' : '复制正文'}
          </button>
        </div>

        <div className="history-modal-body">
          {!loading && hasMore ? (
            <button className="history-load-more" onClick={() => void loadOlder()} disabled={loadingOlder}>
              {loadingOlder ? '正在加载更早记录…' : '加载更早记录'}
            </button>
          ) : null}
          {loading ? (
            <div className="empty-state">正在读取历史…</div>
          ) : messages.length ? (
            visibleMessages.length ? (
              visibleMessages.map((message, index) => (
                <section key={`${message.role}-${index}`} className={`history-message role-${message.role}`}>
                  <div className="history-message-role">{ROLE_LABEL[message.role]}</div>
                  <div className="history-message-text">{message.text}</div>
                </section>
              ))
            ) : (
              <div className="empty-state">没有匹配内容</div>
            )
          ) : visiblePlainText ? (
            <pre className="history-plain-text">{visiblePlainText}</pre>
          ) : (
            <div className="empty-state">{normalizedQuery ? '没有匹配内容' : '（无可阅读正文）'}</div>
          )}
        </div>

        <div className="history-modal-actions">
          <button className="btn" onClick={onRename}>重命名</button>
          {familyAgents && selectedEntryId && onSelectEntry ? (
            <CloneEntrySelect
              agents={familyAgents}
              value={selectedEntryId}
              disabled={entrySelectDisabled}
              disabledReason={entrySelectDisabledReason}
              onChange={onSelectEntry}
            />
          ) : null}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onBranch}>基于此新建</button>
          <button className="btn primary" onClick={onResume} disabled={!canResume} title={canResume ? '' : '当前记录不支持继续会话'}>
            继续会话
          </button>
        </div>
      </div>
    </div>
  )
}
