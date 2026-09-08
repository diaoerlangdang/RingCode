import { create } from 'zustand'
import type { DirHandle } from '@/lib/fs'

export type FsViewMode = 'grid' | 'list' | 'detail' | 'tree'

/** 文件系统浏览状态。DirHandle 不可序列化，故不持久化。 */
interface FsState {
  handle: DirHandle
  segments: string[] // 根目录下的相对路径段
  rootName: string
  view: FsViewMode
  setHandle: (h: DirHandle, rootName: string) => void
  setView: (view: FsViewMode) => void
  enter: (seg: string) => void
  up: () => void
  goto: (segments: string[]) => void
  resetMock: () => void
}

const MOCK_ROOT = 'E:\\workspace'

export const useFsStore = create<FsState>((set) => ({
  handle: { kind: 'mock' },
  segments: [],
  rootName: MOCK_ROOT,
  view: 'grid',
  setHandle: (h, rootName) => set({ handle: h, segments: [], rootName }),
  setView: (view) => set({ view }),
  enter: (seg) => set((s) => ({ segments: [...s.segments, seg] })),
  up: () => set((s) => ({ segments: s.segments.slice(0, -1) })),
  goto: (segments) => set({ segments }),
  resetMock: () => set({ handle: { kind: 'mock' }, segments: [], rootName: MOCK_ROOT }),
}))
