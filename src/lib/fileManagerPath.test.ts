import { describe, expect, it } from 'vitest'
import { fileEntryContextFromTreePath, fileEntryTargetSegments } from './fileManagerPath'

describe('fileEntryContextFromTreePath', () => {
  it('converts a top-level tree node to an empty parent path', () => {
    expect(fileEntryContextFromTreePath(['README.md'], false)).toEqual({
      segs: [],
      name: 'README.md',
      isDir: false,
    })
  })

  it('separates a nested tree node name from its parent path', () => {
    const context = fileEntryContextFromTreePath(['src', 'components', 'FileManager.tsx'], false)

    expect(context).toEqual({
      segs: ['src', 'components'],
      name: 'FileManager.tsx',
      isDir: false,
    })
    expect(fileEntryTargetSegments(context!)).toEqual(['src', 'components', 'FileManager.tsx'])
  })

  it('does not create a context menu target for the tree root', () => {
    expect(fileEntryContextFromTreePath([], true)).toBeNull()
  })

  it('does not double the node name used by reveal/open/rename', () => {
    const context = fileEntryContextFromTreePath(['docs'], true)
    expect(fileEntryTargetSegments(context!)).toEqual(['docs'])
  })

  it('keeps nested folders that share a name', () => {
    const context = fileEntryContextFromTreePath(['foo', 'foo'], true)
    expect(context).toEqual({ segs: ['foo'], name: 'foo', isDir: true })
    expect(fileEntryTargetSegments(context!)).toEqual(['foo', 'foo'])
  })
})
