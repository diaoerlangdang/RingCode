import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertAllowedCwd, resolveSafe, setAllowedRoots } from './pathSafe'

const root = path.resolve('E:', 'ws', 'demo')
const other = path.resolve('E:', 'ws', 'other')

describe('resolveSafe', () => {
  afterEach(() => setAllowedRoots([]))

  it('允许工作区内相对路径', () => {
    setAllowedRoots([root])
    expect(resolveSafe(root, ['src', 'a.ts'])).toBe(path.resolve(root, 'src', 'a.ts'))
  })

  it('允许解析到工作区根本身', () => {
    setAllowedRoots([root])
    expect(resolveSafe(root, [])).toBe(path.resolve(root))
  })

  it('拒绝 .. 逃出工作区', () => {
    setAllowedRoots([root])
    expect(() => resolveSafe(root, ['..', '..', 'Windows'])).toThrow(/越界/)
  })

  it('拒绝绝对路径分段', () => {
    setAllowedRoots([root])
    const abs = path.resolve(path.parse(root).root, 'Windows')
    expect(() => resolveSafe(root, [abs])).toThrow(/非法/)
  })

  it('拒绝未登记的工作区根', () => {
    setAllowedRoots([root])
    expect(() => resolveSafe(other, ['a.ts'])).toThrow(/未登记/)
  })

  it('空 root 抛错', () => {
    setAllowedRoots([root])
    expect(() => resolveSafe('', ['a'])).toThrow(/未打开工作区/)
  })

  it('Windows 下工作区路径大小写不敏感', () => {
    if (process.platform !== 'win32') return
    setAllowedRoots([root])
    const flipped = root[0] === root[0].toLowerCase()
      ? root[0].toUpperCase() + root.slice(1)
      : root[0].toLowerCase() + root.slice(1)
    expect(resolveSafe(flipped, ['a.ts'])).toBe(path.resolve(root, 'a.ts'))
    expect(assertAllowedCwd(flipped)).toBe(path.resolve(flipped))
  })
})
