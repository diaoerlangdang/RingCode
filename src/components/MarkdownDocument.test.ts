import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildSync } from 'esbuild'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const fixture = [
  '# 文档总览', '', '## **中文**与 `代码`', '',
  '```mermaid', 'flowchart LR', 'A[开始] --> B[完成]', '```', '',
  '```mermaid', 'sequenceDiagram', 'Alice->>Bob: 你好', 'Bob-->>Alice: 收到', '```', '',
  '```mermaid', 'this is not a diagram', '```', '',
  '```mermaid', '%%{init: {"securityLevel":"loose","htmlLabels":true,"flowchart":{"htmlLabels":true}}}%%',
  'flowchart LR', 'X["<img src=x onerror=window.injected=true>"] --> Y[安全]', 'click Y "javascript:alert(1)"', '```', '',
  '```text', '# 代码内不是标题', '```', '',
  '## 重复', '', '## 重复', '', '## 重复-2', '',
  '<div data-diagram="0">普通 HTML 内容</div>', '',
  '![本地图片](../images/example.png)', '',
  '<script>window.injected = true</script>', '<img src="data:," onerror="window.injected = true">',
  '[危险链接](javascript:alert(1))', '',
  ...Array.from({ length: 35 }, (_, i) => `## 章节 ${i}\n\n段落内容 ${i}。\n`),
].join('\n')

let dir: string
let report: Record<string, any>

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ringcode-markdown-'))
  const bundle = buildSync({
    stdin: {
      contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
        import { loader } from '@monaco-editor/react';
        import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
        import { CenterPane } from './src/components/CenterPane';
        import { useAppStore } from './src/store/useAppStore';
        import { useEditorStore } from './src/store/useEditorStore';
        import './src/styles/tokens.css'; import './src/styles/base.css'; import './src/styles/app.css';
        loader.config({ monaco });
        window.__appStore = useAppStore; window.__editorStore = useEditorStore; window.__monaco = monaco;
        const start = () => {
          useEditorStore.setState({ files: [{ id: 'doc', name: 'example.markdown', content: ${JSON.stringify(fixture)},
            segments: ['docs', 'example.markdown'], handle: { kind: 'electron', rootPath: ${JSON.stringify(dir)} }, dirty: true }], activeId: 'doc' });
          useAppStore.setState({ centerTopTab: 'preview', terminals: [{ id: 'shell', kind: 'shell', title: '验证终端' }],
            activeTerminalId: 'shell', settings: { ...useAppStore.getState().settings, firstRunDone: true },
            workspaces: [{ id: 'ws', name: '测试', path: ${JSON.stringify(dir)} }], activeWorkspaceId: 'ws' });
          createRoot(document.getElementById('root')).render(<div className="app"><div className="topbar">Markdown 实机回归</div>
            <div className="body"><aside style={{width:200}}>工作区</aside><CenterPane /></div></div>);
        };
        useAppStore.persist.hasHydrated() ? start() : useAppStore.persist.onFinishHydration(start);`,
      loader: 'tsx', resolveDir: root,
    },
    outfile: path.join(dir, 'renderer.js'), bundle: true, platform: 'browser', jsx: 'automatic',
    loader: { '.ttf': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  })
  expect(bundle.errors).toHaveLength(0)
  writeFileSync(path.join(dir, 'index.html'), '<html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>')
  writeFileSync(path.join(dir, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');
    contextBridge.exposeInMainWorld('ringcode', {
      isElectron: true, storeGet: async()=>null, storeSet: async()=>{}, storeDel: async()=>{}, setWorkspaceRoots: async()=>{},
      ptySpawn: opts=>ipcRenderer.invoke('spawn',opts), ptyInput:(id,data)=>ipcRenderer.send('input',id,data),
      ptyResize:()=>{}, ptyDispose: id=>ipcRenderer.send('dispose',id),
      onPtyData: cb=>{ipcRenderer.on('data',(_e,id,data)=>cb(id,data));}, onPtyExit: cb=>{ipcRenderer.on('exit',(_e,id,code)=>cb(id,code));},
      fsReadDataUrl: async()=>{await new Promise(r=>setTimeout(r,80)); return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';},
    });`)
  const checks = `(async()=>{
    const sleep = ms=>new Promise(r=>setTimeout(r,ms));
    const until = async check=>{for(let i=0;i<160;i++){if(check())return; await sleep(50);}throw Error('UI did not become ready');};
    const app=window.__appStore, editor=window.__editorStore;
    const visible = selector=>[...document.querySelectorAll(selector)].filter(el=>el.getBoundingClientRect().width>0 && getComputedStyle(el).visibility==='visible');
    const body=()=>visible('.markdown-body')[0];
    const button = text=>[...document.querySelectorAll('button')].find(el=>el.textContent===text && getComputedStyle(el).visibility==='visible');
    await until(()=>body()?.querySelectorAll('.diagram-render svg').length===3 && body()?.querySelector('.diagram-status.error'));
    const terminal=document.querySelector('.xterm');
    const result={
      headings: [...document.querySelectorAll('.markdown-outline button')].slice(0,5).map(el=>el.textContent),
      ids:[...body().querySelectorAll('h2')].slice(1,4).map(el=>el.id),
      flow:body().querySelector('.diagram-render').textContent.includes('开始'),
      sequence:body().querySelectorAll('.diagram-render')[1].textContent.includes('你好'),
      badDiagram:!!body().querySelector('.diagram-status.error') && !body().querySelector('.diagram-status.error').parentElement.querySelector('pre').hidden,
      ordinaryCode:body().textContent.includes('# 代码内不是标题'),
      unsafe:!!body().querySelector('script,[onerror],a[href^="javascript:"],.diagram-render foreignObject,.diagram-render image,.diagram-render a') || !!window.injected,
      image:body().querySelector('img[alt="本地图片"]').src.startsWith('data:image/png'),
    };
    const last=[...document.querySelectorAll('.markdown-outline button')].at(-1);last.click();await sleep(80);
    result.jump=body().scrollTop>500 && last.getAttribute('aria-current')==='location';
    const scroll=body().scrollTop; editor.setState({files:editor.getState().files.map(f=>({...f,mtime:2}))});await sleep(150);
    result.imagePreservedScroll=body().scrollTop===scroll && body().querySelectorAll('.diagram-render svg').length===3;
    const dark=body().querySelector('.diagram-render svg').outerHTML;
    app.getState().setTheme('light');document.documentElement.dataset.theme='light';
    await until(()=>body().querySelector('.diagram-render svg').outerHTML!==dark);
    result.theme=true;
    const layout=JSON.stringify(app.getState().layout);
    button('最大化预览').click();await sleep(80);
    result.maximized=!!document.querySelector('.document-maximized') && body().getBoundingClientRect().width>700;
    result.terminalRetained=terminal===document.querySelector('.xterm') && JSON.stringify(app.getState().layout)===layout;
    button('还原预览').click();await sleep(80);result.restored=body().scrollTop===scroll && !document.querySelector('.document-maximized');
    app.getState().setCenterTopTab('editor');app.getState().setLayout({editorPreviewSplit:true});
    await until(()=>window.__monaco.editor.getEditors().length===1 && button('最大化编辑器'));
    const ed=window.__monaco.editor.getEditors()[0];ed.setPosition({lineNumber:3,column:4});ed.focus();
    button('最大化编辑器').click();await sleep(80);button('还原编辑器').click();await sleep(80);
    result.editorPreserved=window.__monaco.editor.getEditors()[0]===ed && ed.getPosition().lineNumber===3 && editor.getState().files[0].dirty;
    result.compact=!visible('.markdown-outline').length;
    button('最大化预览').click();await sleep(80);
    result.splitMaximized=!!document.querySelector('.document-maximized') && terminal===document.querySelector('.xterm');
    button('还原预览').click();await sleep(80);
    button('目录').click();await sleep(80);result.compactToggle=visible('.markdown-outline').length===1;
    editor.getState().updateContent('doc',${JSON.stringify(['# 临时标题', '', '```mermaid', 'flowchart LR', 'A[过期内容]-->B', '```'].join('\n'))});
    await sleep(200);
    editor.getState().updateContent('doc',${JSON.stringify(['# 最新标题', '', '```mermaid', 'flowchart LR', 'A[最新内容]-->B', '```'].join('\n'))});
    await until(()=>body().querySelector('.diagram-render svg')?.textContent.includes('最新内容'));
    result.latest=!body().textContent.includes('过期内容') && visible('.markdown-outline button')[0].textContent==='最新标题';
    editor.getState().updateContent('doc','无标题的普通文字');await sleep(100);result.emptyOutline=visible('.outline-empty')[0]?.textContent==='本文没有标题';
    button('最大化预览').click();await sleep(50);
    editor.setState({files:[{...editor.getState().files[0],name:'example.json',content:'{"ok":true}'}]});await sleep(100);
    result.nonMarkdown=!!visible('.preview-json')[0] && !document.querySelector('.document-maximized');
    editor.setState({files:[{...editor.getState().files[0],name:'example.md',content:${JSON.stringify(fixture)}}]});
    app.getState().setCenterTopTab('preview');await until(()=>body()?.querySelectorAll('.diagram-render svg').length===3);
    app.getState().setTheme('dark');document.documentElement.dataset.theme='dark';await sleep(800);
    body().scrollTop=0;
    return result;
  })()`
  const main = path.join(dir, 'main.cjs')
  writeFileSync(main, `const {app,BrowserWindow,ipcMain}=require('electron');const path=require('node:path');
    const pty=require(${JSON.stringify(path.join(root, 'node_modules/node-pty'))});let processHandle,spawnCount=0,disposeCount=0;
    app.setPath('userData',${JSON.stringify(path.join(dir, 'user-data'))});
    app.whenReady().then(async()=>{
      const win=new BrowserWindow({show:false,width:1100,height:850,webPreferences:{preload:path.join(__dirname,'preload.cjs'),backgroundThrottling:false}});
      ipcMain.handle('spawn',async(_e,opts)=>{
        spawnCount++;processHandle=pty.spawn(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile'],{cwd:__dirname,cols:opts.cols,rows:opts.rows});
        processHandle.onData(data=>{if(!win.isDestroyed())win.webContents.send('data','test-process',data)});
        return 'test-process';
      });
      ipcMain.on('input',(_e,_id,data)=>processHandle?.write(data));
      ipcMain.on('dispose',()=>{disposeCount++;processHandle?.kill()});
      await win.loadFile(path.join(__dirname,'index.html'));
      const result=await win.webContents.executeJavaScript(${JSON.stringify(checks)});
      result.processRetained=spawnCount===1 && disposeCount===0 && !!processHandle.pid;
      console.log('MARKDOWN_REPORT:'+JSON.stringify(result));
      if(process.env.RINGCODE_MARKDOWN_SCREENSHOT) {
        await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        require('node:fs').writeFileSync(process.env.RINGCODE_MARKDOWN_SCREENSHOT,(await win.webContents.capturePage()).toPNG());
        require('node:fs').writeFileSync(process.env.RINGCODE_MARKDOWN_SCREENSHOT+'.json',JSON.stringify(result,null,2));
      }
      processHandle?.kill();win.destroy();app.exit(0);
    }).catch(error=>{console.error(error);try{processHandle?.kill()}catch{}app.exit(1)});`)
  const electron = createRequire(import.meta.url)('electron') as string
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const run = spawnSync(electron, [main], { encoding: 'utf8', timeout: 45000, windowsHide: true, env })
  expect(run.status, run.stderr + run.stdout).toBe(0)
  const line = run.stdout.split('\n').find(line => line.startsWith('MARKDOWN_REPORT:'))
  expect(line, run.stdout).toBeTruthy()
  report = JSON.parse(line!.slice('MARKDOWN_REPORT:'.length))
}, 60000)

afterAll(() => {
  if (dir && path.dirname(path.resolve(dir)) === path.resolve(tmpdir()) && path.basename(dir).startsWith('ringcode-markdown-')) {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('renders flowcharts and sequence diagrams while isolating invalid diagrams and preserving ordinary code', () => {
  expect(report).toMatchObject({ flow: true, sequence: true, badDiagram: true, ordinaryCode: true, unsafe: false })
})

it('builds a Chinese outline with unique anchors and jumps/highlights within the preview', () => {
  expect(report.headings).toEqual(['文档总览', '中文与 代码', '重复', '重复', '重复-2'])
  expect(report.ids).toEqual(['重复', '重复-2', '重复-2-2'])
  expect(report).toMatchObject({ jump: true, emptyOutline: true, compact: true, compactToggle: true })
})

it('preserves local images and scroll position, switches diagram theme, and discards obsolete content', () => {
  expect(report).toMatchObject({ image: true, imagePreservedScroll: true, theme: true, latest: true })
})

it('maximizes and restores both panes without recreating Monaco, changing layout or disposing a real ConPTY process', () => {
  expect(report).toMatchObject({ maximized: true, restored: true, terminalRetained: true, editorPreserved: true, splitMaximized: true, processRetained: true })
})

it('keeps JSON preview working and exits maximization when the document stops being Markdown', () => {
  expect(report.nonMarkdown).toBe(true)
})
