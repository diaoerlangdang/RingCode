import { describe, expect, it } from 'vitest'
import { MAX_SKILL_IMPORT_BYTES, assertSkillImportSize } from './skillLimits'

describe('assertSkillImportSize', () => {
  it('允许未超限的导入', () => {
    expect(() => assertSkillImportSize(1024)).not.toThrow()
  })

  it('拒绝超过上限', () => {
    expect(() => assertSkillImportSize(MAX_SKILL_IMPORT_BYTES + 1)).toThrow(/过大/)
  })
})
