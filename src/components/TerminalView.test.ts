import { beforeAll, afterAll, expect, it } from 'vitest'
import { build, buildSync } from 'esbuild'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

let dir: string, report: any
const root = process.cwd()
function cliFrame(family: string, text = '', cols = 80) {
  const rows = text.split('\n')
  if (family === 'opencode') {
    return '\x1b[2J\x1b[H┃\r\n' + rows.map((line) => '┃  ' + (line || (text ? '' : 'Ask anything... "QA"'))).join('\r\n')
      + '\r\n┃\r\n┃  Build · QA\r\n╹' + '─'.repeat(Math.max(4, cols - 1)) + '\r\ntab agents  ctrl+p commands' + `\x1b[${rows.length + 1};4H`
  }
  const physicalRows = rows.reduce((sum, line) => sum + Math.max(1, Math.ceil((2 + [...line].reduce((width, char) => width + (char.codePointAt(0)! >= 0x2e80 ? 2 : 1), 0)) / cols)), 0)
  return '\x1b[2J\x1b[H────────\r\n> ' + rows.join('\r\n  ') + '\r\n────────\r\n? for shortcuts' + `\x1b[${physicalRows + 1};3H`
}
beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'ringcode-composer-'))
  await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
    import {TerminalView} from './src/components/TerminalView';import {useAppStore} from './src/store/useAppStore';
    import {agentById} from './src/lib/agents';import {pasteToTerminal} from './src/lib/terminalRegistry';import {flushStorageWrites} from './src/lib/sqliteStorage';
    import './src/styles/tokens.css';import './src/styles/base.css';import './src/styles/app.css';
    window.qaStore=useAppStore;window.qaPaste=pasteToTerminal;window.qaFlush=flushStorageWrites;window.qaFrame=${cliFrame.toString()};
    function Views(){const ts=useAppStore(s=>s.terminals);return <div style={{height:'calc(100vh - 24px)',display:'flex'}}>{ts.map(t=><div key={t.id} style={{width:'50%',minWidth:0,height:'100%'}}><TerminalView terminal={t} active={true} focused={t.id===ts[0].id}/></div>)}</div>}
    function start(){const s=useAppStore.getState();if(!s.terminals.length){
      const clone={...agentById('claude'),id:'qa-claude-clone',name:'QA Claude',sourceFamily:'claude'};s.setCustomAgents([clone]);
      const cloneProfile={...s.profiles[0],id:'qa-clone-profile',tool:clone.id};s.upsertProfile(cloneProfile);
      const a=s.createSession('claude',s.profiles[0].id,${JSON.stringify(dir)}),b=s.createSession(clone.id,cloneProfile.id,${JSON.stringify(dir)});
      s.newTerminal('ai',{tool:'claude',sessionId:a.id});s.newTerminal('ai',{tool:clone.id,sessionId:b.id});}
      createRoot(document.getElementById('root')).render(<Views/>)}
    useAppStore.persist.hasHydrated()?start():useAppStore.persist.onFinishHydration(start);`, loader: 'tsx', resolveDir: root },
    bundle: true, outfile: path.join(dir, 'renderer.js'), platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'observe-xterm', setup(build) { build.onLoad({ filter: /TerminalView\.tsx$/ }, (args) => ({ contents: readFileSync(args.path, 'utf8').replace('const fit = new FitAddon()', 'window.qaTerms ??= {}; window.qaTerms[terminal.id] = term; window.qaPresentation ??= {}; window.qaPresentation[terminal.id] = () => ({family,mode:modeRef.current,bracketed:term.modes.bracketedPasteMode,regions:nativeInputRegions(term,family),screen:containerRef.current?.querySelector(".xterm-screen")?.getBoundingClientRect().height}); const fit = new FitAddon()'), loader: 'tsx' })) } }], logLevel: 'silent' })
  writeFileSync(path.join(dir, 'index.html'), '<html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>')
  buildSync({ entryPoints: [path.join(root, 'electron/preload.ts')], outfile: path.join(dir, 'preload-base.cjs'), bundle: true, platform: 'node', external: ['electron'], logLevel: 'silent' })
  writeFileSync(path.join(dir, 'preload.cjs'), `require('./preload-base.cjs');const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('qa',{ledger:()=>ipcRenderer.invoke('qa:ledger'),bind:id=>ipcRenderer.invoke('qa:bind',id),paint:(id,text)=>ipcRenderer.invoke('qa:paint',id,text),capture:(name,rect)=>ipcRenderer.invoke('qa:capture',name,rect),clipboard:()=>ipcRenderer.invoke('qa:clipboard'),image:()=>ipcRenderer.invoke('qa:image'),zoom:z=>ipcRenderer.invoke('qa:zoom',z),wheel:(x,y,deltaY)=>ipcRenderer.invoke('qa:wheel',x,y,deltaY)});`)
  const checks = String.raw`(async()=>{
    const sleep=ms=>new Promise(r=>setTimeout(r,ms)),until=async (fn,label='ready')=>{for(let i=0;i<150;i++){if(fn())return;await sleep(30)}throw Error('UI timeout '+label+': '+JSON.stringify({toasts:window.qaStore.getState().toasts,terminals:Object.entries(window.qaTerms??{}).map(([id,t])=>({id,debug:window.qaPresentation[id](),lines:Array.from({length:Math.min(6,t.rows)},(_,i)=>t.buffer.active.getLine(t.buffer.active.baseY+i)?.translateToString(true)||'')}))}))};
    const st=window.qaStore;await until(()=>document.querySelectorAll('.terminal-composer textarea:not(:disabled)').length===2);await sleep(250);
    const [a,b]=st.getState().terminals.map(t=>t.id),sessionA=st.getState().terminals[0].sessionId;
    const composer=id=>document.querySelector('[data-terminal-id="'+id+'"]'),input=id=>composer(id)?.querySelector('textarea');
    const btn=(id,text)=>{const found=[...composer(id).querySelectorAll('button')].find(b=>b.textContent===text);if(!found)throw Error('Missing button '+text+': '+composer(id).textContent);return found};
    const set=(id,text)=>st.getState().setTerminalDraft(id,{text,images:st.getState().terminalDrafts[id]?.images??[]});
    const ledger=()=>window.qa.ledger(),result={};
    const frame=id=>composer(id).parentElement.querySelector('.terminal-output-frame'),masks=id=>[...frame(id).querySelectorAll('.terminal-input-mask')];
    function xtermReadonly(id){const keys=frame(id).querySelector('.xterm-helper-textarea');return keys.readOnly&&keys.tabIndex===-1&&window.qaTerms[id].options.cursorBlink===false&&masks(id).every(m=>{const color=getComputedStyle(m).backgroundColor;return color!=='transparent'&&!color.endsWith(', 0)')})}
    result.scrollFamilies={};
    async function checkReplay(id,family){
      const t=window.qaTerms[id],tag='replay-'+family+'-';
      const prompt=family==='claude'?'❯ ':family==='codex'?'────────\r\n› \r\n────────\r\n? for shortcuts\x1b[2A\r\x1b[2C':window.qaFrame(family,'',t.cols);
      await window.qa.paint(id,'\x1b[r\x1b[2J\x1b[H'+Array.from({length:160},(_,i)=>tag+i+'\r\n').join('')+'\r\n'.repeat(t.rows)+prompt);await sleep(250);
      t.scrollToBottom();await sleep(80);
      const vp=frame(id).querySelector('.xterm-viewport'),rect=frame(id).querySelector('.xterm-screen').getBoundingClientRect(),before=t.buffer.active.viewportY;
      await window.qa.wheel(Math.round(rect.left+10),Math.round(rect.top+10),100);await sleep(150);
      const wheel=t.buffer.active.viewportY<before;
      vp.scrollTop=0;await sleep(150);
      const top=t.buffer.active.viewportY===0;
      for(const fraction of [0.25,0.6,1,0.3]){vp.scrollTop=(vp.scrollHeight-vp.clientHeight)*fraction;await sleep(50)}
      const rendered=[...frame(id).querySelector('.xterm-rows').children].map(r=>r.textContent.trimEnd());
      const expected=Array.from({length:t.rows},(_,i)=>t.buffer.active.getLine(t.buffer.active.viewportY+i)?.translateToString(true)||'');
      const lines=Array.from({length:t.buffer.active.length},(_,i)=>t.buffer.active.getLine(i)?.translateToString(true)||'').filter(l=>l.startsWith(tag));
      result.scrollFamilies[family]=wheel&&top&&JSON.stringify(rendered)===JSON.stringify(expected)&&lines.length===160&&new Set(lines).size===160;
      t.scrollToBottom();await sleep(100);
    }
    window.qaTerms[a].scrollToBottom();await until(()=>masks(a).length>0&&xtermReadonly(a),'initial input hidden');result.hiddenInput=true;
    const maskRect=masks(a)[0].getBoundingClientRect(),beforeWheel=window.qaTerms[a].buffer.active.viewportY;
    await window.qa.wheel(Math.round(maskRect.left+maskRect.width/2),Math.round(maskRect.top+maskRect.height/2),100);await sleep(180);
    result.wheelOverHiddenInput=window.qaTerms[a].buffer.active.viewportY<beforeWheel;
    window.qaTerms[a].scrollToBottom();await sleep(100);
    await checkReplay(a,'claude');
    window.qaPaste(a,'第一行\n\n第二行');window.qaPaste(b,'另一个草稿');await sleep(80);
    result.isolated=input(a).value==='第一行\n\n第二行'&&input(b).value==='另一个草稿';
    const viewport=document.querySelector('.xterm-viewport');window.qaTerms[a].scrollToTop();await sleep(80);
    await until(()=>masks(a).length===0,'history mask removed');
    result.historyMasks=masks(a).length===0;
    const position=viewport.scrollTop;input(a).focus();set(a,'第一行\n\n第二行');await sleep(80);
    result.sticky=viewport.scrollTop===position&&input(a).getBoundingClientRect().bottom<=window.innerHeight;
    await window.qa.paint(a,'新输出\r\n❯ ');await sleep(200);result.history=viewport.scrollTop===position;
    input(a).dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,shiftKey:true}));
    input(a).dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
    input(a).dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,isComposing:true}));
    input(a).dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));await sleep(80);
    result.ime=(await ledger()).filter(e=>e.data.includes('200~')).length===0;
    input(a).dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await until(()=>!input(a).disabled&&input(a).value==='');
    const sent=(await ledger()).filter(e=>e.id===a);result.multiline=sent.some(e=>e.data==='\x1b[200~第一行\n\n第二行\x1b[201~')&&sent.filter(e=>e.data==='\r').length===1;
    result.target=input(b).value==='另一个草稿'&&!(await ledger()).some(e=>e.id===b&&e.data==='\r');
    // Replay the trust menu: key presses must reach the CLI without submitting the composer draft.
    const xinput=document.querySelector('.xterm-helper-textarea');set(a,'菜单前草稿');await sleep(80);
    input(a).focus();const trustMenu='\x1b[2J\x1b[HThis folder pre-approves tool permissions\r\n\r\n> No, exit\r\n  Yes, I trust this folder\r\n\r\nEnter to confirm · Esc to cancel';
    await window.qa.paint(b,trustMenu);await sleep(250);result.backgroundMenu=document.activeElement===input(a)&&input(b).disabled;
    await window.qa.paint(b,'\x1b[2J\x1b[H❯ ');await sleep(250);
    const menuBefore=(await ledger()).length;
    await window.qa.paint(a,trustMenu);await sleep(250);
    result.menuNoAuto=(await ledger()).length===menuBefore;
    result.menuFocus=document.activeElement===xinput&&input(a).disabled;
    await until(()=>!xinput.readOnly,'menu native keyboard');
    result.menuVisible=masks(a).length===0&&!xinput.readOnly;
    xinput.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',keyCode:40,bubbles:true,cancelable:true}));
    xinput.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27,bubbles:true,cancelable:true}));
    xinput.dispatchEvent(new KeyboardEvent('keydown',{key:'c',keyCode:67,ctrlKey:true,bubbles:true,cancelable:true}));
    xinput.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,bubbles:true,cancelable:true}));await sleep(250);
    const menuWrites=(await ledger()).slice(menuBefore);result.menuKeys=menuWrites.some(e=>e.data==='\x1b[B')&&menuWrites.some(e=>e.data==='\x1b')&&menuWrites.some(e=>e.data==='\r');
    result.menuCopy=!menuWrites.some(e=>e.data==='\x03');result.menuDraft=input(a).value==='菜单前草稿'&&input(b).value==='另一个草稿';
    result.menuRestored=!input(a).disabled&&document.activeElement===input(a);
    await window.qa.paint(a,'\x1b[2J\x1b[H❯ ');await sleep(250);
    // A native draft and confirmation menu must block automatic submit.
    btn(a,'原生终端操作').click();await sleep(70);
    await until(()=>!xinput.readOnly,'direct input keyboard');
    result.nativeVisible=masks(a).length===0&&!xinput.readOnly&&!frame(a).classList.contains('terminal-output-only');
    xinput.dispatchEvent(new KeyboardEvent('keydown',{key:'x',keyCode:88,bubbles:true,cancelable:true}));await sleep(70);
    await window.qa.paint(a,'\x1b[2J\x1b[H❯ 已有输入');await sleep(200);btn(a,'返回底部输入框').click();await sleep(70);
    result.nativeDraft=!!btn(a,'返回底部输入框')&&input(a).disabled;
    await window.qa.paint(a,'\x1b[2J\x1b[H❯ ');await sleep(200);btn(a,'返回底部输入框').click();await sleep(70);
    await window.qa.paint(a,'\x1b[2J\x1b[HDo you want to allow this?');await sleep(200);set(a,'保留草稿');await sleep(70);
    const before=(await ledger()).length;btn(a,'发送').click();await sleep(180);
    result.menu=(await ledger()).length===before&&input(a).value==='保留草稿';
    await window.qa.paint(a,'\x1b[2J\x1b[H✽ Whirring… (2s · thinking)\r\n\r\n\r\n\r\n\r\n❯ ');await sleep(200);btn(a,'发送').click();await sleep(180);
    result.busy=(await ledger()).length===before&&input(a).value==='保留草稿';
    await window.qa.paint(a,'\x1b[2J\x1b[H可复制输出\r\n❯ ');await sleep(250);
    window.qaTerms[a].selectAll();xinput.dispatchEvent(new KeyboardEvent('keydown',{key:'c',keyCode:67,ctrlKey:true,bubbles:true,cancelable:true}));await sleep(70);
    result.selectionCopy=(await window.qa.clipboard()).includes('可复制输出')&&!(await window.qa.clipboard()).includes('❯');window.qaTerms[a].clearSelection();
    xinput.dispatchEvent(new KeyboardEvent('keydown',{key:'c',keyCode:67,ctrlKey:true,bubbles:true,cancelable:true}));
    input(a).dispatchEvent(new KeyboardEvent('keydown',{key:'c',ctrlKey:true,bubbles:true,cancelable:true}));await sleep(70);
    result.copy=!(await ledger()).some(e=>e.data==='\x03');btn(a,'中断任务').click();await sleep(70);
    result.interrupt=(await ledger()).some(e=>e.id===a&&e.data==='\x1b');
    // Clipboard images are copied through the actual controlled main-process cache.
    await window.qa.image();const image=await window.ringcode.attachmentClipboard();st.getState().setTerminalDraft(a,{text:'图片问题',images:[image]});await until(()=>composer(a).querySelector('img'));
    result.thumbnail=!!composer(a).querySelector('img');await window.qaFlush();
    result.draftProtected=(await window.ringcode.attachmentClean([image.id])).deleted===0;
    btn(a,'发送').click();await until(()=>!input(a).disabled&&input(a).value==='','image submit');await window.qaFlush();
    result.imagePath=(await ledger()).some(e=>e.data.includes(JSON.stringify(image.path).slice(1,-1)));
    result.sentRef=st.getState().sessions.find(s=>s.id===sessionA).imageIds.includes(image.id);
    st.getState().setTerminalDraft(a,{text:'缩放草稿',images:[image]});await sleep(120);result.zoom=true;
    for(const scale of [1.25,1.5]){await window.qa.zoom(scale);await sleep(200);result.zoom&&=input(a).getBoundingClientRect().bottom<=window.innerHeight&&btn(a,'发送').getBoundingClientRect().bottom<=window.innerHeight;}
    const thumbnail=composer(a).querySelector('.composer-image button');thumbnail.click();await sleep(80);
    result.largePreview=document.querySelector('.composer-image-dialog')?.getBoundingClientRect().width>=window.innerWidth-1;
    document.querySelector('.composer-image-dialog button').click();await window.qa.zoom(1);await sleep(100);
    result.extraFamilies=true;result.extraPresentation=true;
    for(const family of ['antigravity','opencode']){
      const s=st.getState().createSession(family,st.getState().profiles.find(p=>p.tool===family).id,st.getState().sessions[0].projectPath);
      const id=st.getState().newTerminal('ai',{tool:family,sessionId:s.id});await until(()=>input(id)&&!input(id).disabled,'new family composer');await sleep(200);await window.qa.bind(id);
      await until(()=>masks(id).length>0&&xtermReadonly(id),'family input hidden');
      result.extraPresentation&&=masks(id).length>0&&xtermReadonly(id);
      const raw=window.qaTerms[id],buffer=raw.buffer.active;const rawText=Array.from({length:raw.rows},(_,i)=>buffer.getLine(buffer.baseY+i)?.translateToString(true)||'').join('\n');
      result.extraPresentation&&=rawText.includes(family==='opencode'?'Ask anything':'? for shortcuts');
      for(const scale of [1.25,1.5]){await window.qa.zoom(scale);await sleep(150);await until(()=>{const rect=frame(id).getBoundingClientRect();return masks(id).length>0&&masks(id).every(m=>{const r=m.getBoundingClientRect();return r.left>=rect.left-1&&r.right<=rect.right+1&&r.top>=rect.top-1&&r.bottom<=rect.bottom+1})},'zoom masks within output')}
      await window.qa.zoom(1);await sleep(150);
      set(id,'第一行\n\n第二行');await sleep(70);btn(id,'发送').click();await until(()=>!input(id).disabled&&input(id).value==='','family multiline');
      const writes=(await ledger()).filter(e=>e.id===id);result.extraFamilies&&=writes.some(e=>e.data==='\x1b[200~第一行\n\n第二行\x1b[201~')&&writes.filter(e=>e.data==='\r').length===1;
      st.getState().setTerminalDraft(id,{text:'图片问题',images:[image]});await sleep(250);btn(id,'发送').click();await until(()=>!input(id).disabled&&input(id).value==='','family image path');
      result.extraFamilies&&=(await ledger()).some(e=>e.id===id&&e.data.includes(JSON.stringify(image.path).slice(1,-1)))&&st.getState().sessions.find(x=>x.id===s.id).imageIds.includes(image.id);
      set(id,'菜单保留');await sleep(70);const count=(await ledger()).length;
      const menu=family==='antigravity'?'\x1b[2J\x1b[H> Yes, I trust this folder\r\n  No, exit\r\n  ↑/↓ Navigate · enter Confirm':'\x1b[2J\x1b[HCommands                        esc\r\nSearch\r\nSwitch model';
      await window.qa.paint(id,menu);await until(()=>input(id).disabled,'family menu '+family);await sleep(70);
      result.extraPresentation&&=masks(id).length===0;
      result.extraFamilies&&=(await ledger()).length===count;
      const keys=composer(id).parentElement.querySelector('.xterm-helper-textarea');keys.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',keyCode:40,bubbles:true,cancelable:true}));keys.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,bubbles:true,cancelable:true}));await until(()=>!input(id).disabled,'menu exit');
      result.extraFamilies&&=input(id).value==='菜单保留'&&(await ledger()).slice(count).some(e=>e.id===id&&e.data==='\x1b[B');
      await until(()=>masks(id).length>0&&xtermReadonly(id),'menu input mask restored');result.extraPresentation&&=masks(id).length>0&&xtermReadonly(id);
      const mask=masks(id)[0];if(!mask){const t=window.qaTerms[id],b=t.buffer.active;throw Error('Missing restored input mask: '+family+JSON.stringify({debug:window.qaPresentation[id](),base:b.baseY,viewport:b.viewportY,cursor:[b.cursorX,b.cursorY],cols:t.cols,readonly:frame(id).className,lines:Array.from({length:t.rows},(_,i)=>b.getLine(b.baseY+i)?.translateToString(true)||'')}))};frame(id).querySelector('.terminal-output').dispatchEvent(new MouseEvent('mouseup',{button:0,bubbles:true}));result.extraPresentation&&=document.activeElement===input(id);
      const capture=async mode=>{const r=composer(id).parentElement.getBoundingClientRect();await window.qa.capture(family+'-'+mode,{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)})};
      await capture('composer');btn(id,'原生终端操作').click();await until(()=>!frame(id).querySelector('.xterm-helper-textarea').readOnly,'family direct input');await capture('native');btn(id,'返回底部输入框').click();await until(()=>masks(id).length>0&&xtermReadonly(id),'family composer restored');
      await checkReplay(id,family);
      st.getState().deleteSession(s.id);await sleep(100);
    }
    const codexSession=st.getState().createSession('codex',st.getState().profiles.find(p=>p.tool==='codex').id,st.getState().sessions[0].projectPath);
    const codexId=st.getState().newTerminal('ai',{tool:'codex',sessionId:codexSession.id});await until(()=>input(codexId)&&!input(codexId).disabled,'codex replay');await sleep(150);await window.qa.bind(codexId);
    await checkReplay(codexId,'codex');st.getState().deleteSession(codexSession.id);await sleep(100);
    // A second session shares this copy; closing a tab does not remove it.
    const sessionB=st.getState().terminals[1].sessionId;st.getState().retainSessionImages(sessionB,[image.id]);
    st.getState().closeTerminal(a);await sleep(70);await window.qaFlush();
    result.closeRetains=!!(await window.ringcode.attachmentRead(image.id)).dataUrl;
    st.getState().deleteSession(sessionA);await sleep(150);result.sharedRetains=!!(await window.ringcode.attachmentRead(image.id)).dataUrl;
    // Persist a new draft to validate real SQLite hydration on reload.
    set(b,'重启保留');await window.qaFlush();result.remainingId=b;result.imageId=image.id;
    return result;
  })()`
  const afterReload = `(async()=>{const sleep=ms=>new Promise(r=>setTimeout(r,ms));for(let i=0;i<150&&!document.querySelector('textarea');i++)await sleep(30);const st=window.qaStore;const result={restored:Object.values(st.getState().terminalDrafts).some(d=>d.text==='重启保留'),orphaned:st.getState().terminals.every(t=>t.orphaned)};for(const s of [...st.getState().sessions])st.getState().deleteSession(s.id);await window.qaFlush();await sleep(100);result.cleaned=(await window.ringcode.attachmentStats()).count===0;return result})()`
  await build({ stdin: { contents: `import {app,BrowserWindow,ipcMain,clipboard,nativeImage} from 'electron';
    import {registerDbHandlers} from './electron/db';import {registerAttachmentHandlers} from './electron/attachmentIpc';
    import * as fs from 'node:fs';import * as path from 'node:path';
    app.setPath('userData',${JSON.stringify(path.join(dir, 'user-data'))});let win,seq=0,savedClipboard;const entries=[],launches=[],tabs=new Map(),processTabs=new Map();const cliFrame=${cliFrame.toString()};
    app.whenReady().then(async()=>{
      fs.mkdirSync(app.getPath('userData'),{recursive:true});registerDbHandlers();registerAttachmentHandlers();
      win=new BrowserWindow({show:false,width:1200,height:800,webPreferences:{preload:path.join(__dirname,'preload.cjs'),backgroundThrottling:false,offscreen:true,sandbox:false}});
      win.webContents.on('console-message',(_e,level,message)=>{if(level>=2)console.error('renderer: '+message)});
      ipcMain.handle('pty:spawn',(_e,opts)=>{launches.push({tool:opts.cloneId|| (opts.exe.includes('codex')?'codex':opts.exe.includes('opencode')?'opencode':opts.exe.includes('agy')?'antigravity':'claude'),classic:opts.env?.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN??'unset'});const id='proc'+(++seq),family=opts.exe.includes('opencode')?'opencode':opts.exe.includes('agy')?'antigravity':'claude';tabs.set(id,{text:'',family,cols:opts.cols,painted:false});setTimeout(()=>win.webContents.send('pty:data',id,'\\x1b[?2004h'+(family==='claude'?Array.from({length:100},(_,i)=>'历史输出 '+i+'\\r\\n').join('')+'❯ ':cliFrame(family,'',opts.cols))),50);return id});
      ipcMain.handle('workspace:setRoots',()=>{});ipcMain.handle('history:findRecent',()=>null);
      ipcMain.on('pty:input',(_e,id,data)=>{entries.push({id,data});const t=tabs.get(id);if(!t)return;
        if(data.startsWith('\\x1b[200~')){const text=data.slice(6,-6),lines=text.trim().split('\\n').length;t.text=t.family==='opencode'&&lines>=3?'[Pasted ~'+lines+' lines]':text;t.painted=false;win.webContents.send('pty:data',id,t.family==='claude'?text.replace(/\\n/g,'\\r\\n'):cliFrame(t.family,t.text,t.cols));}
        else if(data==='\\r'){t.text='';t.painted=false;win.webContents.send('pty:data',id,t.family==='claude'?'\\r\\n已接收\\r\\n❯ ':cliFrame(t.family,'',t.cols));}
      });ipcMain.on('pty:resize',(_e,id,cols)=>{const t=tabs.get(id);if(t&&t.cols!==cols){t.cols=cols;if(t.family!=='claude'&&!t.painted)win.webContents.send('pty:data',id,cliFrame(t.family,t.text,t.cols))}});ipcMain.on('pty:dispose',(_e,id)=>tabs.delete(id));
      ipcMain.handle('qa:ledger',()=>entries.map(e=>({id:processTabs.get(e.id),data:e.data})));let windowIds=[];
      ipcMain.handle('qa:bind',(_e,id)=>processTabs.set([...tabs.keys()].at(-1),id));
      ipcMain.handle('qa:paint',(_e,tabId,text)=>{const p=[...processTabs].find(([_p,t])=>t===tabId)?.[0];const t=tabs.get(p);if(t)t.painted=true;win.webContents.send('pty:data',p,text)});
      ipcMain.handle('qa:clipboard',()=>clipboard.readText());
      ipcMain.handle('qa:image',()=>clipboard.writeImage(fixtureImage));
      ipcMain.handle('qa:zoom',(_e,z)=>win.webContents.setZoomFactor(z));
      ipcMain.handle('qa:wheel',(_e,x,y,deltaY)=>{win.webContents.sendInputEvent({type:'mouseMove',x,y});win.webContents.sendInputEvent({type:'mouseWheel',x,y,deltaY,canScroll:true})});
      const screenshots=${JSON.stringify(process.env.RINGCODE_QA_SCREENSHOTS ?? '')};ipcMain.handle('qa:capture',async(_e,name,rect)=>{if(!screenshots)return;fs.mkdirSync(screenshots,{recursive:true});const image=await win.webContents.capturePage(rect,{stayHidden:true,stayAwake:true});fs.writeFileSync(path.join(screenshots,name+'.png'),image.toPNG())});
      savedClipboard={text:clipboard.readText(),html:clipboard.readHTML(),rtf:clipboard.readRTF(),image:clipboard.readImage()};
      const fixtureImage=nativeImage.createFromBitmap(Buffer.alloc(16,255),{width:2,height:2});clipboard.writeImage(fixtureImage);
      await win.loadFile(path.join(__dirname,'index.html'));for(let i=0;i<150;i++){windowIds=await win.webContents.executeJavaScript('window.qaStore?.getState().terminals.map(t=>t.id)||[]');if(windowIds.length===2)break;await new Promise(r=>setTimeout(r,30))}
      for(let i=0;i<150&&tabs.size<2;i++)await new Promise(r=>setTimeout(r,30));
      [...tabs.keys()].forEach((p,i)=>processTabs.set(p,windowIds[i]));
      const result=await win.webContents.executeJavaScript(${JSON.stringify(checks)});result.launches=launches;await win.reload();
      await new Promise(r=>win.webContents.once('did-finish-load',r));Object.assign(result,await win.webContents.executeJavaScript(${JSON.stringify(afterReload)}));
      console.log('COMPOSER_REPORT:'+JSON.stringify(result));clipboard.write(savedClipboard);win.destroy();app.exit(0);
    }).catch(e=>{console.error(e);if(savedClipboard)clipboard.write(savedClipboard);app.exit(1)});`, resolveDir: root }, bundle: true, platform: 'node', outfile: path.join(dir, 'main.cjs'), external: ['electron'],
    plugins: [{ name: 'native-db', setup(build) { build.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: createRequire(import.meta.url).resolve('better-sqlite3'), external: true })) } }], logLevel: 'silent' })
  const env = { ...process.env, NODE_PATH: path.join(root, 'node_modules') }
  delete env.ELECTRON_RUN_AS_NODE
  const run = spawnSync(createRequire(import.meta.url)('electron'), [path.join(dir, 'main.cjs')], { env, windowsHide: true, timeout: 40000, encoding: 'utf8' })
  expect(run.status, run.stderr + run.stdout).toBe(0)
  const line = run.stdout.split('\n').find((line) => line.startsWith('COMPOSER_REPORT:'))
  expect(line, run.stdout).toBeTruthy()
  report = JSON.parse(line!.slice('COMPOSER_REPORT:'.length))
}, 60000)
afterAll(() => {
  if (dir && path.dirname(path.resolve(dir)) === path.resolve(tmpdir()) && path.basename(dir).startsWith('ringcode-composer-')) rmSync(dir, { recursive: true, force: true })
})
it('keeps per-terminal drafts visible, handles IME, and submits multiline content to one target', () => {
  expect(report).toMatchObject({ isolated: true, sticky: true, history: true, ime: true, multiline: true, target: true })
})
it('preserves drafts at native prompts and menus; copying does not interrupt the PTY', () => {
  expect(report).toMatchObject({ nativeDraft: true, menu: true, busy: true, copy: true, selectionCopy: true, interrupt: true })
})
it('routes trust-menu navigation, confirmation and cancel keys while preserving drafts and copy', () => {
  expect(report).toMatchObject({ menuNoAuto: true, menuKeys: true, menuDraft: true, menuCopy: true, menuFocus: true, menuRestored: true, backgroundMenu: true })
})
it('submits multiline text and managed image paths through the Antigravity and OpenCode composers', () => {
  expect(report.extraFamilies).toBe(true)
})
it('hides native input without changing the buffer, restores menus and direct input, and respects scroll and zoom', () => {
  expect(report).toMatchObject({ hiddenInput: true, wheelOverHiddenInput: true, historyMasks: true, menuVisible: true, nativeVisible: true, extraPresentation: true })
})
it('persists image references and drafts, preserves shared copies, and cleans only after session deletion', () => {
  expect(report).toMatchObject({ thumbnail: true, draftProtected: true, imagePath: true, sentRef: true, zoom: true, largePreview: true, closeRetains: true, sharedRetains: true, restored: true, orphaned: true, cleaned: true })
})

it('scrolls resumed Claude, Codex, Antigravity and OpenCode history with wheel and scrollbar without repeating rows', () => {
  expect(report.scrollFamilies).toEqual({claude:true,codex:true,antigravity:true,opencode:true})
})

it('uses classic Claude rendering for the original and its clone while keeping other CLI environments unchanged', () => {
  expect(report.launches).toEqual([
    { tool: 'claude', classic: '1' },
    { tool: 'qa-claude-clone', classic: '1' },
    { tool: 'antigravity', classic: 'unset' },
    { tool: 'opencode', classic: 'unset' },
    { tool: 'codex', classic: 'unset' },
  ])
})
