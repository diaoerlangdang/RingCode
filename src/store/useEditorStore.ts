import { create } from 'zustand'
import type { DirHandle } from '@/lib/fs'
import { readTextFile, writeTextFile, statEntry } from '@/lib/fs'
import { uid } from './useAppStore'

export interface OpenFile {
  id: string
  name: string
  segments: string[]
  handle: DirHandle
  content: string
  dirty: boolean
  mtime?: number
  conflict?: boolean
}

function sameOpenFile(file: OpenFile, handle: DirHandle, segments: string[]): boolean {
  if (file.segments.join('/') !== segments.join('/') || file.handle.kind !== handle.kind) return false
  if (file.handle.kind === 'electron' && handle.kind === 'electron') {
    return file.handle.rootPath.replace(/[\\/]+$/, '').toLowerCase() === handle.rootPath.replace(/[\\/]+$/, '').toLowerCase()
  }
  if (file.handle.kind === 'real' && handle.kind === 'real') return file.handle.handle === handle.handle
  return file.handle.kind === 'mock'
}

interface EditorState {
  files: OpenFile[]
  activeId: string | null
  openFile: (handle: DirHandle, segments: string[]) => Promise<OpenFile | null>
  closeFile: (id: string) => void
  setActive: (id: string) => void
  updateContent: (id: string, content: string) => void
  markSaved: (id: string) => void
  saveFile: (id: string) => Promise<boolean>
  reloadFromDisk: (id: string) => Promise<boolean>
  markConflict: (id: string, conflict: boolean) => void
}

export const useEditorStore = create<EditorState>((set, get) => ({
  files: [],
  activeId: null,
  openFile: async (handle, segments) => {
    // 已打开则直接激活
    const existing = get().files.find((f) => sameOpenFile(f, handle, segments))
    if (existing) {
      set({ activeId: existing.id })
      const st = await statEntry(handle, segments)
      if (st?.mtime !== undefined && st.mtime !== existing.mtime) {
        if (existing.dirty) get().markConflict(existing.id, true)
        else await get().reloadFromDisk(existing.id)
      }
      return get().files.find((f) => f.id === existing.id) ?? existing
    }
    const content = await readTextFile(handle, segments)
    if (content === null) return null
    const st = await statEntry(handle, segments)
    const file: OpenFile = {
      id: uid(),
      name: segments[segments.length - 1],
      segments,
      handle,
      content,
      dirty: false,
      mtime: st?.mtime,
    }
    set((s) => ({ files: [...s.files, file], activeId: file.id }))
    return file
  },
  closeFile: (id) =>
    set((s) => {
      const idx = s.files.findIndex((f) => f.id === id)
      const files = s.files.filter((f) => f.id !== id)
      let active = s.activeId
      if (active === id) active = files[idx] ? files[idx].id : files[idx - 1]?.id ?? files[0]?.id ?? null
      return { files, activeId: active }
    }),
  setActive: (id) => set({ activeId: id }),
  updateContent: (id, content) =>
    set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, content, dirty: true } : f)) })),
  markSaved: (id) => set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, dirty: false } : f)) })),
  saveFile: async (id) => {
    const f = get().files.find((x) => x.id === id)
    if (!f) return false
    try {
      await writeTextFile(f.handle, f.segments, f.content)
      const st = await statEntry(f.handle, f.segments)
      set((s) => ({ files: s.files.map((x) => (x.id === id ? { ...x, dirty: false, conflict: false, mtime: st?.mtime } : x)) }))
      return true
    } catch {
      return false
    }
  },
  reloadFromDisk: async (id) => {
    const f = get().files.find((x) => x.id === id)
    if (!f) return false
    const content = await readTextFile(f.handle, f.segments)
    if (content === null) return false
    const st = await statEntry(f.handle, f.segments)
    set((s) => ({
      files: s.files.map((x) => (x.id === id ? { ...x, content, dirty: false, conflict: false, mtime: st?.mtime } : x)),
    }))
    return true
  },
  markConflict: (id, conflict) =>
    set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, conflict } : f)) })),
}))
