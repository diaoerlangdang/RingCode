import { describe, expect, it } from 'vitest'
import { fileMatchesFsChange, syncChangedOpenFiles } from './editorFileSync'

const file = {
  handle: { kind: 'electron' as const, rootPath: 'E:\\work\\demo', name: 'demo' },
  segments: ['docs', 'README.md'],
}

describe('fileMatchesFsChange', () => {
  it('匹配同一工作区内的 Windows 相对路径', () => {
    expect(fileMatchesFsChange(file, {
      event: 'change',
      filename: 'docs\\README.md',
      rootPath: 'e:\\WORK\\demo\\',
    })).toBe(true)
  })

  it('不把其他工作区的同名文件当成当前文件', () => {
    expect(fileMatchesFsChange(file, {
      event: 'change',
      filename: 'docs/README.md',
      rootPath: 'E:\\work\\other',
    })).toBe(false)
  })

  it('filename 为空时复核该根目录的所有已打开文件', () => {
    expect(fileMatchesFsChange(file, {
      event: 'rename',
      filename: '',
      rootPath: 'E:\\work\\demo',
    })).toBe(true)
  })

  it('浏览器和 mock 句柄不消费 Electron 监听事件', () => {
    expect(fileMatchesFsChange({ handle: { kind: 'mock' }, segments: ['docs', 'README.md'] }, {
      event: 'change',
      filename: 'docs/README.md',
      rootPath: 'E:\\work\\demo',
    })).toBe(false)
  })
})

describe('syncChangedOpenFiles', () => {
  const change = { event: 'change', filename: 'docs/README.md', rootPath: 'E:\\work\\demo' }
  const openFile = { ...file, id: 'file-1', name: 'README.md', dirty: false, conflict: false }

  it('未编辑的已打开文件自动从磁盘重载', async () => {
    const reloaded: string[] = []
    await syncChangedOpenFiles([openFile], [change], {
      reload: async (id) => { reloaded.push(id); return true },
      markConflict: () => { throw new Error('不应标记冲突') },
      notifyConflict: () => { throw new Error('不应提示冲突') },
    })
    expect(reloaded).toEqual(['file-1'])
  })

  it('有未保存编辑时不覆盖内容，只标记并提示一次冲突', async () => {
    const marked: string[] = []
    const notified: string[] = []
    let reloadCount = 0
    await syncChangedOpenFiles([{ ...openFile, dirty: true }], [change], {
      reload: async () => { reloadCount++; return true },
      markConflict: (id) => marked.push(id),
      notifyConflict: (name) => notified.push(name),
    })
    expect(reloadCount).toBe(0)
    expect(marked).toEqual(['file-1'])
    expect(notified).toEqual(['README.md'])
  })

  it('已存在冲突提示时不重复通知', async () => {
    let notified = 0
    await syncChangedOpenFiles([{ ...openFile, dirty: true, conflict: true }], [change], {
      reload: async () => true,
      markConflict: () => undefined,
      notifyConflict: () => { notified++ },
    })
    expect(notified).toBe(0)
  })
})
