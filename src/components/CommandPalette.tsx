import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { getCommands, runCommand } from '@/lib/commands'

export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen)
  const close = useAppStore((s) => s.closeCommandPalette)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const customAgents = useAppStore((s) => s.settings.customAgents)
  const keymap = useAppStore((s) => s.settings.keymap)
  const commands = useMemo(() => getCommands(), [open, customAgents, keymap])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q))
  }, [query, commands])

  // 分组保留顺序
  const groups = useMemo(() => {
    const map = new Map<string, typeof commands>()
    for (const c of filtered) {
      if (!map.has(c.group)) map.set(c.group, [])
      map.get(c.group)!.push(c)
    }
    return Array.from(map.entries())
  }, [filtered])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => setActive(0), [query])

  if (!open) return null

  const exec = async (id: string) => {
    close()
    await runCommand(id)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const cmd = filtered[active]
      if (cmd) exec(cmd.id)
    }
  }

  let idx = -1

  return (
    <div className="modal-overlay" onClick={close} style={{ alignItems: 'flex-start' }}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cp-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder="输入命令名搜索…"
        />
        <div className="cp-list">
          {filtered.length === 0 ? (
            <div className="cp-empty">无匹配命令</div>
          ) : (
            groups.map(([group, cmds]) => (
              <div key={group}>
                <div className="cp-group-title">{group}</div>
                {cmds.map((c) => {
                  idx++
                  const isActive = idx === active
                  return (
                    <div
                      key={c.id}
                      className={`cp-item ${isActive ? 'active' : ''}`}
                      onClick={() => exec(c.id)}
                      onMouseEnter={() => setActive(idx)}
                    >
                      <span>{c.label}</span>
                      {c.shortcut && <span className="cp-key">{c.shortcut}</span>}
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
