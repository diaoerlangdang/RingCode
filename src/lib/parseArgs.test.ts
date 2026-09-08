import { describe, expect, it } from 'vitest'
import { parseArgs } from './parseArgs'

describe('parseArgs', () => {
  it('空字符串得到空数组', () => {
    expect(parseArgs('')).toEqual([])
    expect(parseArgs('   ')).toEqual([])
  })

  it('按空格切分并去掉引号', () => {
    expect(parseArgs('--model sonnet')).toEqual(['--model', 'sonnet'])
    expect(parseArgs('--permission-mode auto')).toEqual(['--permission-mode', 'auto'])
    expect(parseArgs('"--foo bar" baz')).toEqual(['--foo bar', 'baz'])
  })
})
