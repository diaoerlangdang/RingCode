import { describe, it, expect } from 'vitest'
import {
  getLanguageByFilename,
  getLanguageIdByFilename,
  getFileCategory,
  listSupportedLanguages,
  registerLanguage,
} from './languages'

describe('languages adapter', () => {
  it('detects requested languages accurately', () => {
    expect(getLanguageIdByFilename('App.vue')).toBe('vue')
    expect(getLanguageIdByFilename('main.py')).toBe('python')
    expect(getLanguageIdByFilename('script.pyw')).toBe('python')
    expect(getLanguageIdByFilename('Main.java')).toBe('java')
    expect(getLanguageIdByFilename('index.js')).toBe('javascript')
    expect(getLanguageIdByFilename('Component.jsx')).toBe('javascript')
    expect(getLanguageIdByFilename('index.ts')).toBe('typescript')
    expect(getLanguageIdByFilename('App.tsx')).toBe('typescript')
    expect(getLanguageIdByFilename('index.html')).toBe('html')
  })

  it('detects other common languages', () => {
    expect(getLanguageIdByFilename('main.go')).toBe('go')
    expect(getLanguageIdByFilename('lib.rs')).toBe('rust')
    expect(getLanguageIdByFilename('server.cpp')).toBe('cpp')
    expect(getLanguageIdByFilename('header.h')).toBe('cpp')
    expect(getLanguageIdByFilename('Program.cs')).toBe('csharp')
    expect(getLanguageIdByFilename('query.sql')).toBe('sql')
    expect(getLanguageIdByFilename('config.yaml')).toBe('yaml')
    expect(getLanguageIdByFilename('config.yml')).toBe('yaml')
    expect(getLanguageIdByFilename('deploy.sh')).toBe('shell')
    expect(getLanguageIdByFilename('script.ps1')).toBe('powershell')
    expect(getLanguageIdByFilename('Dockerfile')).toBe('dockerfile')
    expect(getLanguageIdByFilename('README.md')).toBe('markdown')
    expect(getLanguageIdByFilename('style.css')).toBe('css')
    expect(getLanguageIdByFilename('data.json')).toBe('json')
  })

  it('falls back to plaintext for unknown files', () => {
    expect(getLanguageIdByFilename('unknown.xyz')).toBe('plaintext')
    expect(getLanguageIdByFilename('')).toBe('plaintext')
    expect(getLanguageByFilename('unknown.xyz')).toBeNull()
  })

  it('categorizes file types properly for icons', () => {
    expect(getFileCategory('App.vue')).toBe('code')
    expect(getFileCategory('main.py')).toBe('code')
    expect(getFileCategory('Main.java')).toBe('code')
    expect(getFileCategory('config.json')).toBe('config')
    expect(getFileCategory('docker-compose.yml')).toBe('config')
    expect(getFileCategory('README.md')).toBe('doc')
    expect(getFileCategory('style.css')).toBe('style')
    expect(getFileCategory('logo.png')).toBe('image')
    expect(getFileCategory('banner.webp')).toBe('image')
    expect(getFileCategory('random.bin')).toBe('default')
  })

  it('allows registering custom language adapters', () => {
    registerLanguage({
      id: 'solidity',
      name: 'Solidity',
      extensions: ['.sol'],
      category: 'code',
      color: '#aa6746',
    })

    expect(getLanguageIdByFilename('Token.sol')).toBe('solidity')
    expect(getFileCategory('Token.sol')).toBe('code')
  })
})
