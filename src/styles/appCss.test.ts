import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./app.css', import.meta.url), 'utf8')

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

describe('topbar menus', () => {
  it('allows dropdowns to extend below the topbar without changing update-modal clipping', () => {
    expect(declarations('.topbar')).toMatch(/overflow:\s*visible\s*;/)
    expect(declarations('.update-modal')).toMatch(/overflow:\s*hidden\s*;/)
  })
})
