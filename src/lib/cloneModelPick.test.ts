import { describe, expect, it } from 'vitest'
import { visibleCloneModels } from './cloneModelPick'

const models = ['mimo-v2.5', 'mimo-v2.5-pro', 'mimo-v2.5-tts']

describe('visibleCloneModels', () => {
  it('未在输入时展示全部，即使当前已选中一项', () => {
    expect(visibleCloneModels(models, 'mimo-v2.5-pro', false)).toEqual(models)
  })

  it('输入时按包含关系筛选', () => {
    expect(visibleCloneModels(models, 'pro', true)).toEqual(['mimo-v2.5-pro'])
    expect(visibleCloneModels(models, '  ', true)).toEqual(models)
  })
})
