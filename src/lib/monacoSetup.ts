// Bundle Monaco locally (offline / no CDN) and wire up its web workers via
// Vite's `?worker` imports. Must run before the first <Editor> mounts —
// imported for its side effects from main.tsx.
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}

// Tell @monaco-editor/react to use the locally bundled monaco instance
// instead of fetching it from a CDN at runtime.
loader.config({ monaco })

// 初始化语言适配器中的自定义高亮（如 Vue SFC 等）
import { initCustomLanguages } from './languages'
initCustomLanguages(monaco)

export { monaco }
