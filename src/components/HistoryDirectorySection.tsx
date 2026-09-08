import type { ReactNode } from 'react'
import type { HistoryDirectoryRelation } from '@/lib/historyGrouping'

interface Props {
  name: string
  path: string
  relation: HistoryDirectoryRelation
  totalCount: number
  matchedCount: number
  latestAt: number
  available: boolean
  unknown: boolean
  expanded: boolean
  filtering: boolean
  loading?: boolean
  hasMore?: boolean
  children: ReactNode
  onToggle: () => void
  onMenu: (event: React.MouseEvent) => void
  onLoadMore?: () => void
  formatTime: (value: number) => string
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`history-directory-chevron-icon ${expanded ? 'open' : ''}`}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 3.5l4.5 4.5L6 12.5" />
    </svg>
  )
}

export function HistoryDirectorySection({
  name,
  path,
  relation,
  totalCount,
  matchedCount,
  latestAt,
  available,
  unknown,
  expanded,
  filtering,
  loading,
  hasMore,
  children,
  onToggle,
  onMenu,
  onLoadMore,
  formatTime,
}: Props) {
  const count = filtering ? `${matchedCount} / ${totalCount}` : String(totalCount)
  return (
    <section className={`history-directory ${expanded ? 'expanded' : ''}`}>
      <div className="history-directory-head" onContextMenu={onMenu}>
        <button
          className="history-directory-toggle"
          aria-expanded={expanded}
          onClick={onToggle}
          title={path || '无法识别原工作目录'}
        >
          <span className="history-directory-chevron" aria-hidden="true">
            <ChevronIcon expanded={expanded} />
          </span>
          <span className="history-directory-info">
            <span className="history-directory-title-row">
              <span className="history-directory-name">{name}</span>
              {relation === 'root' ? <span className="directory-badge current">当前工作区</span> : null}
              {relation === 'child' ? <span className="directory-badge">子目录</span> : null}
              {!available && !unknown ? <span className="directory-badge unavailable">目录不可用</span> : null}
            </span>
            <span className="history-directory-path">{path || '无法识别原工作目录'}</span>
            <span className="history-directory-time">最近更新：{formatTime(latestAt)}</span>
          </span>
          <span className="history-directory-count">{count}</span>
        </button>
        <button className="history-directory-more" onClick={onMenu} aria-label={`${name} 目录操作`}>…</button>
      </div>
      {expanded ? (
        <div className="history-directory-body">
          {children}
          {loading ? <div className="history-group-loading">正在加载…</div> : null}
          {!loading && hasMore ? (
            <button className="history-load-more" onClick={onLoadMore}>加载更多</button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
