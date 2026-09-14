import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { listAgents } from '@/lib/agents'
import { isCloneAgent } from '@/lib/agentFamily'
import { DEFAULT_KEYMAP } from '@/lib/keymap'
import { runCommand } from '@/lib/commands'
import { fitPinnedCount, visibleAgents } from '@/lib/quickLaunch'
import type { AgentDef } from '@/types'

function shortcutOf(agent: AgentDef, keymap?: Record<string, string>): string | undefined {
  return keymap?.[`ai.${agent.id}`] || (agent.shortcutDigit ? DEFAULT_KEYMAP[`ai.${agent.id}`] : undefined)
}

function agentCaption(agent: AgentDef): string {
  if (isCloneAgent(agent) && agent.commandName) return agent.commandName
  return agent.command
}

export function QuickLaunchCluster({ onManage }: { onManage: () => void }) {
  const customAgents = useAppStore((s) => s.settings.customAgents)
  const quickLaunch = useAppStore((s) => s.settings.quickLaunch)
  const keymap = useAppStore((s) => s.settings.keymap)
  const profiles = useAppStore((s) => s.profiles)
  const openSettings = useAppStore((s) => s.openSettings)
  const agents = listAgents(customAgents ?? [])
  const visible = useMemo(() => visibleAgents(agents, quickLaunch), [agents, quickLaunch])

  const clusterRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const moreBtnRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [pinned, setPinned] = useState(Math.min(4, visible.length))
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  useLayoutEffect(() => {
    const cluster = clusterRef.current
    const measure = measureRef.current
    if (!cluster || !measure) return
    const buttons = [...measure.querySelectorAll<HTMLElement>('[data-measure-agent]')]
    const more = measure.querySelector<HTMLElement>('[data-measure-more]')
    const buttonWidths = buttons.map((el) => el.getBoundingClientRect().width)
    const moreWidth = more?.getBoundingClientRect().width ?? 72
    const available = cluster.getBoundingClientRect().width
    setPinned(
      fitPinnedCount({
        visibleCount: visible.length,
        buttonWidths,
        moreWidth,
        availableWidth: Math.max(0, available),
      }),
    )
  }, [visible])

  useEffect(() => {
    const cluster = clusterRef.current
    if (!cluster) return
    const ro = new ResizeObserver(() => {
      const measure = measureRef.current
      if (!measure) return
      const buttons = [...measure.querySelectorAll<HTMLElement>('[data-measure-agent]')]
      const more = measure.querySelector<HTMLElement>('[data-measure-more]')
      const buttonWidths = buttons.map((el) => el.getBoundingClientRect().width)
      const moreWidth = more?.getBoundingClientRect().width ?? 72
      setPinned(
        fitPinnedCount({
          visibleCount: visible.length,
          buttonWidths,
          moreWidth,
          availableWidth: Math.max(0, cluster.getBoundingClientRect().width),
        }),
      )
    })
    ro.observe(cluster)
    return () => ro.disconnect()
  }, [visible])

  const overflow = visible.slice(pinned)
  const showMore = overflow.length > 0 || pinned === 0
  const moreItems = pinned === 0 ? visible : overflow
  const moreLabel = pinned === 0 ? '启动 Agent' : `更多（${overflow.length}）`
  const filtered = moreItems.filter((agent) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return `${agent.name}\n${agent.command}\n${agent.commandName ?? ''}\n${agent.sourceFamily ?? ''}`.toLowerCase().includes(q)
  })

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const node = event.target as Node
      if (clusterRef.current?.contains(node)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        moreBtnRef.current?.focus()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      requestAnimationFrame(() => searchRef.current?.focus())
    }
  }, [open])

  const launch = (agent: AgentDef) => {
    setOpen(false)
    void runCommand(`ai.${agent.id}`)
  }

  const configure = (agent: AgentDef) => {
    setOpen(false)
    const profile = profiles.find((item) => item.tool === agent.id)
    openSettings('keys', profile?.id)
  }

  const renderButton = (agent: AgentDef, measure = false) => {
    const shortcut = shortcutOf(agent, keymap)
    const missing = isCloneAgent(agent) && !profiles.find((profile) => profile.tool === agent.id)?.credentialSet
    return (
      <button
        key={agent.id}
        data-measure-agent={measure ? '' : undefined}
        className="tool-btn agent-tool-btn"
        title={`启动 ${agent.name}${shortcut ? ` (${shortcut})` : ''}${missing ? ' · 待补配置' : ''}`}
        aria-label={`启动 ${agent.name}${shortcut ? `，快捷键 ${shortcut}` : ''}`}
        onClick={measure ? undefined : () => launch(agent)}
        tabIndex={measure ? -1 : 0}
      >
        <img src={agent.icon} alt="" aria-hidden="true" data-mono={agent.iconMode === 'mono' ? '' : undefined} />
        <span className="agent-tool-label">{agent.name}</span>
      </button>
    )
  }

  if (!visible.length) return <div className="topbar-launch" aria-hidden="true" />

  return (
    <div className="topbar-launch" ref={clusterRef}>
      <div className="quick-launch-measure" ref={measureRef} aria-hidden="true">
        {visible.map((agent) => renderButton(agent, true))}
        <button data-measure-more="" className="tool-btn agent-tool-btn quick-more-btn" tabIndex={-1}>
          启动 Agent
        </button>
      </div>
      {visible.slice(0, pinned).map((agent) => renderButton(agent))}
      {showMore ? (
        <div className="quick-more">
          <button
            ref={moreBtnRef}
            className="tool-btn agent-tool-btn quick-more-btn"
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setOpen(true)
              }
            }}
          >
            {moreLabel} ▾
          </button>
          {open ? (
            <div className="quick-more-panel" role="listbox" aria-label={moreLabel}>
              <div className="search-box">
                <span aria-hidden="true">⌕</span>
                <input
                  ref={searchRef}
                  value={query}
                  aria-label="搜索可启动的 Agent"
                  placeholder="搜索显示名 / 命令名"
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setActiveIndex(0)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      setActiveIndex((index) => Math.min(filtered.length - 1, index + 1))
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      setActiveIndex((index) => Math.max(0, index - 1))
                    } else if (event.key === 'Enter') {
                      event.preventDefault()
                      const agent = filtered[activeIndex]
                      if (agent) launch(agent)
                    }
                  }}
                />
              </div>
              <div className="quick-more-list">
                {filtered.length ? (
                  filtered.map((agent, index) => {
                    const missing = isCloneAgent(agent) && !profiles.find((profile) => profile.tool === agent.id)?.credentialSet
                    return (
                      <div
                        key={agent.id}
                        className={`quick-more-item ${index === activeIndex ? 'active' : ''}`}
                        role="option"
                        aria-selected={index === activeIndex}
                        onMouseEnter={() => setActiveIndex(index)}
                      >
                        <button type="button" className="quick-more-launch" onClick={() => launch(agent)}>
                          <img src={agent.icon} alt="" aria-hidden="true" data-mono={agent.iconMode === 'mono' ? '' : undefined} />
                          <span>
                            <strong>{agent.name}</strong>
                            <em>{agentCaption(agent)}{missing ? ' · 待补配置' : ''}</em>
                          </span>
                        </button>
                        {missing ? (
                          <button type="button" className="quick-more-config" onClick={() => configure(agent)}>
                            去配置
                          </button>
                        ) : null}
                      </div>
                    )
                  })
                ) : (
                  <div className="quick-more-empty">
                    没有匹配项
                    <button className="text-action" onClick={() => setQuery('')}>
                      清除搜索
                    </button>
                  </div>
                )}
              </div>
              <button
                className="quick-more-manage"
                onClick={() => {
                  setOpen(false)
                  onManage()
                }}
              >
                管理快速启动
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
