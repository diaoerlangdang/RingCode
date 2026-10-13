import { expect, it } from 'vitest'
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

it('keeps resumed history scrollable without adding or repeating a row', async () => {
  const root = process.cwd(), dir = mkdtempSync(path.join(tmpdir(), 'ringcode-viewport-'))
  try {
    await build({ stdin: { contents: `import {Terminal} from '@xterm/xterm';import '@xterm/xterm/css/xterm.css';import './src/styles/base.css';
      import {syncTerminalViewport} from './src/lib/terminalViewport';
      window.check=async()=>{
        const sleep=ms=>new Promise(r=>setTimeout(r,ms));
        const host=document.getElementById('terminal');
        host.style.display='none';
        const term=new Terminal({cols:80,rows:24,scrollback:5000,fontSize:14,windowsPty:{backend:'conpty',buildNumber:22621}});term.open(host);
        const write=data=>new Promise(r=>term.write(data,r));
        const text=()=>Array.from({length:term.buffer.active.length},(_,i)=>term.buffer.active.getLine(i).translateToString(true));
        const viewport=host.querySelector('.xterm-viewport'),screen=host.querySelector('.xterm-screen');
        // Resume replays history immediately after fitting the new terminal.
        await write(Array.from({length:40},(_,i)=>'history-'+i+'\\r\\n').join(''));
        term.resize(80,25);term.resize(80,24);
        await write(Array.from({length:160},(_,i)=>'history-'+(i+40)+'\\r\\n').join('')+'❯ ');
        host.style.display='block';term.resize(80,24);syncTerminalViewport(term);
        await sleep(120);
        const history=text(),rowHeight=screen.clientHeight/term.rows;
        const initialRange=viewport.scrollHeight-viewport.clientHeight;
        viewport.scrollTop=0;await sleep(80);
        const resumeScroll=term.buffer.active.viewportY===0;
        term.scrollToBottom();await sleep(40);
        // Force the stale DOM range left by a hidden/unfinished viewport refresh.
        // A repair must not reset the CLI's scroll margins or append a history row.
        await write('\\x1b[2;20r\\x1b[20;1H');await sleep(40);
        host.querySelector('.xterm-scroll-area').style.height='0px';
        const baseBefore=term.buffer.active.baseY;
        const repairedStale=syncTerminalViewport(term);await sleep(80);
        await write('\\r\\nprotected-output');await sleep(40);
        const preservesMargins=repairedStale&&term.buffer.active.baseY===baseBefore&&term.buffer.active.getLine(baseBefore+19).translateToString(true)==='protected-output';
        await write('\\x1b[r\\x1b[24;1H');
        // Hidden-tab history and repeated restoration must preserve every buffer row.
        host.style.display='none';await write('\\r\\n'+Array.from({length:80},(_,i)=>'later-'+i+'\\r\\n').join('')+'❯ \\x1b[5;3H');await sleep(80);
        const before=text(),cursorBefore=[term.buffer.active.baseY,term.buffer.active.cursorY,term.buffer.active.cursorX];
        host.style.display='block';const repaired=syncTerminalViewport(term);await sleep(120);
        const unchanged=JSON.stringify(before)===JSON.stringify(text())&&JSON.stringify(cursorBefore)===JSON.stringify([term.buffer.active.baseY,term.buffer.active.cursorY,term.buffer.active.cursorX]);
        viewport.scrollTop=0;await sleep(80);
        const restoredScroll=term.buffer.active.viewportY===0;
        const displayed=[...host.querySelector('.xterm-rows').children].map(r=>r.textContent.trimEnd());
        const expected=Array.from({length:term.rows},(_,i)=>term.buffer.active.getLine(term.buffer.active.viewportY+i).translateToString(true));
        const renderedRows=JSON.stringify(displayed)===JSON.stringify(expected);
        const result={resumeScroll,restoredScroll,unchanged,renderedRows,repaired,preservesMargins,initialRange,expectedRange:(history.length-term.rows)*rowHeight};term.dispose();return result;
      };`, resolveDir: root }, bundle: true, platform: 'browser', outfile: path.join(dir, 'renderer.js'), logLevel: 'silent' })
    writeFileSync(path.join(dir, 'index.html'), '<html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"></head><body><div id="terminal" style="width:800px;height:450px"></div><script src="renderer.js"></script></body></html>')
    writeFileSync(path.join(dir, 'main.cjs'), `const{app,BrowserWindow}=require('electron');app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1000,height:700,webPreferences:{offscreen:true,backgroundThrottling:false}});await win.loadFile(${JSON.stringify(path.join(dir, 'index.html'))});const result=await win.webContents.executeJavaScript('window.check()');console.log('VIEWPORT_REPORT:'+JSON.stringify(result));win.destroy();app.exit(0)}).catch(e=>{console.error(e);app.exit(1)})`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const run = spawnSync(createRequire(import.meta.url)('electron'), [path.join(dir, 'main.cjs')], { env, windowsHide: true, timeout: 15000, encoding: 'utf8' })
    expect(run.status, run.stderr + run.stdout).toBe(0)
    const line = run.stdout.split('\n').find(line => line.startsWith('VIEWPORT_REPORT:'))
    expect(line, run.stdout).toBeTruthy()
    const result = JSON.parse(line!.slice('VIEWPORT_REPORT:'.length))
    expect(result).toMatchObject({ resumeScroll: true, restoredScroll: true, unchanged: true, renderedRows: true, preservesMargins: true })
    expect(result.initialRange).toBeGreaterThanOrEqual(result.expectedRange - 1)
  } finally {
    if (path.dirname(path.resolve(dir)) === path.resolve(tmpdir()) && path.basename(dir).startsWith('ringcode-viewport-')) rmSync(dir, { recursive: true, force: true })
  }
}, 30000)
