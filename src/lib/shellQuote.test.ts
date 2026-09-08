import { describe, expect, it } from 'vitest'
import { quoteForShell } from './shellQuote'

describe('quoteForShell', () => {
  it('无空格原样返回', () => {
    expect(quoteForShell('C:\\proj\\a.ts')).toBe('C:\\proj\\a.ts')
  })

  it('含空格用单引号包裹，内部单引号加倍', () => {
    expect(quoteForShell("C:\\my docs\\o'reilly.ts")).toBe("'C:\\my docs\\o''reilly.ts'")
  })
})
