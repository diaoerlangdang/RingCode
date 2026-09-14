import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { runCommand } from '@/lib/commands'
import { DEFAULT_KEYMAP, matchShortcut } from '@/lib/keymap'
import { listAgents } from '@/lib/agents'

/** 焦点在输入框 / Monaco 编辑器 / 终端内时，单键类快捷键让位（文件管理器快捷键等复用） */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return true
  if (el.closest('.monaco-editor')) return true
  if (el.closest('.xterm')) return true
  return false
}

/** 全局快捷键。终端/编辑器聚焦时部分单键让位。可在设置中覆盖 keymap。 */
export function useShortcuts() {
  const chord = useRef(0)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      const km = { ...DEFAULT_KEYMAP, ...(useAppStore.getState().settings.keymap ?? {}) }

      if (chord.current && Date.now() - chord.current < 900) {
        if (e.ctrlKey && key === 't') {
          e.preventDefault()
          runCommand('view.theme')
          chord.current = 0
          return
        }
        chord.current = 0
      }
      if (e.ctrlKey && !e.shiftKey && !e.altKey && key === 'k') {
        e.preventDefault()
        chord.current = Date.now()
        return
      }

      if (matchShortcut(e, km['view.commandPalette'] || 'Ctrl+Shift+P')) {
        e.preventDefault()
        useAppStore.getState().openCommandPalette()
        return
      }

      const always = [
        ...listAgents(useAppStore.getState().settings.customAgents ?? []).map((agent) => `ai.${agent.id}`),
        'ai.history',
        'terminal.new',
        'file.search',
        'view.toggleRight',
      ]
      // 自定义 Agent 也走 Ctrl+Shift+digit 以外的覆盖项
      const extraAi = Object.keys(km).filter((id) => id.startsWith('ai.') && id !== 'ai.history')
      for (const id of new Set([...always, ...extraAi])) {
        if (km[id] && matchShortcut(e, km[id])) {
          e.preventDefault()
          runCommand(id)
          return
        }
      }

      if (isTypingTarget(e.target)) return
      if (km['file.quickOpen'] && matchShortcut(e, km['file.quickOpen'])) {
        e.preventDefault()
        runCommand('file.quickOpen')
        return
      }
      if (km['view.toggleLeft'] && matchShortcut(e, km['view.toggleLeft'])) {
        e.preventDefault()
        runCommand('view.toggleLeft')
        return
      }
      if (km['view.toggleBottom'] && matchShortcut(e, km['view.toggleBottom'])) {
        e.preventDefault()
        runCommand('view.toggleBottom')
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
