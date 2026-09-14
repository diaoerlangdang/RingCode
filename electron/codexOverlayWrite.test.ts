import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeCodexOverlay } from './codexOverlayWrite'
import { listOwnedResources } from './ownedResources'

describe('Codex overlay 归属写入', () => {
  it('只覆盖带本分身标记的文件，并登记归属', () => {
    const root = path.join(os.tmpdir(), `ringcode-overlay-${process.pid}-${Date.now()}`)
    const cloneId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    const content = `# Owned by RingCode. cloneId=${cloneId}\nmodel_provider = "ringcode-clone"\n`
    const first = writeCodexOverlay({ cloneId, profileName: `ringcode-${cloneId}`, content }, root)
    expect(first.ok).toBe(true)
    const second = writeCodexOverlay({ cloneId, profileName: `ringcode-${cloneId}`, content: `${content}model = "x"\n` }, root)
    expect(second.ok).toBe(true)
    const foreign = writeCodexOverlay(
      { cloneId: 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee', profileName: `ringcode-${cloneId}`, content: `# Owned by RingCode. cloneId=bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee\n` },
      root,
    )
    expect(foreign.ok).toBe(false)
    const owned = listOwnedResources(path.join(root, '.ringcode', 'owned-resources.json'))
    expect(owned.some((item) => item.kind === 'codexOverlay' && item.cloneId === cloneId)).toBe(true)
  })
})
