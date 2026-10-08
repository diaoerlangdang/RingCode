import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildSync } from 'esbuild'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const fixture = [
  '## 修复内容', '', '- **滚动恢复**', '- 支持 `codex`', '',
  '1. 检查更新', '2. 安装', '', '> 保留本地数据', '',
  '```sh', 'codex --no-alt-screen', '```', '',
  '| 功能 | 状态 |', '| --- | --- |', '| 滚动 | 已修复 |', '',
  '[发布详情](https://github.com/diaoerlangdang/RingCode/releases)', '',
  '<script>window.injected = true</script>',
  '<img src="data:," onerror="window.injected = true">',
  '[恶意链接](javascript:alert(1))', '',
  ...Array.from({ length: 30 }, (_, i) => `段落 ${i}\n`),
].join('\n')

let dir: string
let report: Record<string, any>
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ringcode-update-notes-'))
  const css = ['tokens', 'base', 'app'].map(name => readFileSync(path.join(root, `src/styles/${name}.css`), 'utf8')).join('\n')
  const bundle = buildSync({
    stdin: {
      contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
        import { UpdateModal } from './src/components/UpdateModal';
        createRoot(document.getElementById('root')).render(<UpdateModal />);`,
      loader: 'tsx', resolveDir: root,
    },
    bundle: true, write: false, platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  }).outputFiles[0].text
  const script = `
    const { app, BrowserWindow } = require('electron');
    app.whenReady().then(async () => {
      const win = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { backgroundThrottling: false } });
      await win.loadURL('data:text/html,<div id="root"></div>');
      await win.webContents.executeJavaScript(${JSON.stringify(`
        Object.defineProperty(window, 'localStorage', { value: { getItem: () => null, setItem() {}, removeItem() {} } });
        const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style);
        window.ringcode = { checkAppUpdate: async () => ({ newer: false }) };
        window.open = (...args) => { window.opened = args; return null; }; void 0;
      `)});
      await win.webContents.executeJavaScript(${JSON.stringify(bundle + ';void 0;')});
      const report = await win.webContents.executeJavaScript(${JSON.stringify(`(async () => {
        const wait = () => new Promise(resolve => setTimeout(resolve, 50));
        await wait();
        const show = notes => window.dispatchEvent(new CustomEvent('ringcode:update-available', { detail: {
          newer: true, currentVersion: '0.4.5', latestVersion: '0.4.6', releaseName: '更新说明',
          releaseNotes: notes, releaseUrl: 'https://github.com/diaoerlangdang/RingCode/releases/tag/v0.4.6',
          publishedAt: null, downloadUrl: null, channel: 'installer',
        }}));
        show(${JSON.stringify(fixture)}); await wait();
        const notes = document.querySelector('.update-notes');
        const link = [...notes.querySelectorAll('a')].find(a => a.textContent === '发布详情');
        const before = location.href; link?.click();
        const result = {
          heading: notes.querySelector('h2')?.textContent,
          unordered: notes.querySelectorAll('ul li').length,
          ordered: notes.querySelectorAll('ol li').length,
          bold: notes.querySelector('strong')?.textContent,
          code: notes.querySelector('pre code')?.textContent.trim(),
          table: !!notes.querySelector('table th'), quote: !!notes.querySelector('blockquote'),
          unsafe: !!notes.querySelector('script, [onerror], a[href^="javascript:"]') || !!window.injected,
          opened: window.opened, stayed: before === location.href,
          scrolls: notes.scrollHeight > notes.clientHeight && getComputedStyle(notes).overflowY === 'auto',
        };
        show(''); await wait(); result.empty = notes.textContent.includes('本次发布未填写更新说明。');
        show('### 下一版本\\n\\n新说明'); await wait();
        result.changed = notes.querySelector('h3')?.textContent;
        show(${JSON.stringify(fixture)}); await wait();
        return result;
      })()`)});
      console.log('UPDATE_NOTES_REPORT:' + JSON.stringify(report));
      if (process.env.RINGCODE_UPDATE_NOTES_SCREENSHOT) {
        await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        require('node:fs').writeFileSync(process.env.RINGCODE_UPDATE_NOTES_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
      }
      win.destroy(); app.exit(0);
    }).catch(error => { console.error(error); app.exit(1); });
  `
  const main = path.join(dir, 'main.cjs')
  writeFileSync(main, script)
  const electron = createRequire(import.meta.url)('electron') as string
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const run = spawnSync(electron, [main], { encoding: 'utf8', timeout: 20000, windowsHide: true, env })
  expect(run.status, run.stderr).toBe(0)
  const line = run.stdout.split('\n').find(line => line.startsWith('UPDATE_NOTES_REPORT:'))
  expect(line, run.stdout).toBeTruthy()
  report = JSON.parse(line!.slice('UPDATE_NOTES_REPORT:'.length))
}, 25000)

afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

it('renders GitHub Markdown headings, lists, emphasis, code, tables and quotes in the real update dialog', () => {
  expect(report).toMatchObject({ heading: '修复内容', unordered: 2, ordered: 2, bold: '滚动恢复', code: 'codex --no-alt-screen', table: true, quote: true })
  expect(report.scrolls).toBe(true)
})

it('removes executable HTML and unsafe links from release notes', () => {
  expect(report.unsafe).toBe(false)
})

it('opens release links externally without navigating the application', () => {
  expect(report.opened).toEqual(['https://github.com/diaoerlangdang/RingCode/releases', '_blank', 'noopener,noreferrer'])
  expect(report.stayed).toBe(true)
})

it('updates rendered notes for a later release and keeps the empty-notes fallback', () => {
  expect(report.empty).toBe(true)
  expect(report.changed).toBe('下一版本')
})
