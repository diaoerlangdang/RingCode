// 语言适配器与注册表（Language Adapter Registry）
// 统一管理：Monaco 编辑器语法高亮映射、文件扩展名识别、注释规则与文件管理器图标分类。
import type * as monacoType from 'monaco-editor'

export type FileCategory = 'code' | 'config' | 'doc' | 'style' | 'image' | 'default'

export interface LanguageAdapter {
  id: string              // Monaco 内部识别的语言 ID，如 'python', 'vue', 'java'
  name: string            // 人类可读名称，如 'Python', 'Vue SFC', 'Java'
  extensions: string[]    // 匹配的后缀（小写带点），如 ['.py', '.pyw']
  filenames?: string[]    // 精确匹配的文件名，如 ['Dockerfile', 'Makefile']
  category: FileCategory  // 关联文件图标视觉类别
  color?: string          // 语义主色调
  customSetup?: (monaco: typeof monacoType) => void
}

/** 注册 Vue SFC（单文件组件）轻量 Monarch 高亮器 */
export function setupVueLanguage(monaco: typeof monacoType): void {
  const existing = monaco.languages.getLanguages().some((l) => l.id === 'vue')
  if (existing) return

  monaco.languages.register({
    id: 'vue',
    extensions: ['.vue'],
    aliases: ['Vue', 'vue'],
    mimetypes: ['text/x-vue'],
  })

  monaco.languages.setLanguageConfiguration('vue', {
    comments: {
      blockComment: ['<!--', '-->'],
    },
    brackets: [
      ['<!--', '-->'],
      ['<', '>'],
      ['{', '}'],
      ['(', ')'],
      ['[', ']'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '`', close: '`' },
      { open: '<!--', close: '-->', notIn: ['comment', 'string'] },
      { open: '<', close: '>', notIn: ['string'] },
    ],
  })

  monaco.languages.setMonarchTokensProvider('vue', {
    defaultToken: '',
    tokenPostfix: '.vue',
    ignoreCase: true,

    tokenizer: {
      root: [
        [/<!--/, 'comment', '@comment'],
        // 脚本标签，内嵌 JavaScript 语法高亮
        [
          /(<)(script)([^>]*)(>)/,
          [
            'delimiter',
            'tag',
            'attribute',
            { token: 'delimiter', next: '@scriptEmbedded', nextEmbedded: 'text/javascript' },
          ],
        ],
        // 样式标签，内嵌 CSS 语法高亮
        [
          /(<)(style)([^>]*)(>)/,
          [
            'delimiter',
            'tag',
            'attribute',
            { token: 'delimiter', next: '@styleEmbedded', nextEmbedded: 'text/css' },
          ],
        ],
        // 模板标签与普通 HTML 标签
        [/(<\/?)([\w-]+)/, ['delimiter', { token: 'tag', next: '@tag' }]],
        // 插值表达式 {{ ... }}
        [/\{\{/, { token: 'delimiter.bracket', next: '@mustache' }],
        { include: '@whitespace' },
      ],

      tag: [
        [/[ \t\r\n]+/, 'white'],
        // Vue 指令：v-if, v-model, @click, :bind, #slot 等
        [/(@|:|#|v-[\w-]+)([\w.-]*)/, ['keyword', 'attribute.name']],
        [/[\w-]+/, 'attribute.name'],
        [/=/, 'delimiter'],
        [/"([^"\\]|\\.)*"/, 'attribute.value'],
        [/'([^'\\]|\\.)*'/, 'attribute.value'],
        [/\/>/, 'delimiter', '@pop'],
        [/>/, 'delimiter', '@pop'],
      ],

      scriptEmbedded: [
        [/<\/script>/, { token: '@rematch', next: '@pop', nextEmbedded: '@pop' }],
      ],

      styleEmbedded: [
        [/<\/style>/, { token: '@rematch', next: '@pop', nextEmbedded: '@pop' }],
      ],

      mustache: [
        [/\}\}/, { token: 'delimiter.bracket', next: '@pop' }],
        [/[\w$]+/, 'variable'],
        [/[0-9]+/, 'number'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/'([^'\\]|\\.)*'/, 'string'],
        { include: '@whitespace' },
      ],

      comment: [
        [/[^-]+/, 'comment'],
        [/-->/, 'comment', '@pop'],
        [/[-]/, 'comment'],
      ],

      whitespace: [[/[ \t\r\n]+/, 'white']],
    },
  })
}

/** 内置语言适配器列表（按匹配优先级排序） */
export const BUILTIN_LANGUAGES: LanguageAdapter[] = [
  // Web 前端核心
  {
    id: 'vue',
    name: 'Vue SFC',
    extensions: ['.vue'],
    category: 'code',
    color: '#41b883',
    customSetup: setupVueLanguage,
  },
  {
    id: 'typescript',
    name: 'TypeScript',
    extensions: ['.ts', '.tsx', '.mts', '.cts'],
    category: 'code',
    color: '#3178c6',
  },
  {
    id: 'javascript',
    name: 'JavaScript',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    category: 'code',
    color: '#f7df1e',
  },
  {
    id: 'html',
    name: 'HTML',
    extensions: ['.html', '.htm', '.xhtml'],
    category: 'style',
    color: '#e34f26',
  },
  {
    id: 'css',
    name: 'CSS',
    extensions: ['.css', '.scss', '.less'],
    category: 'style',
    color: '#1572b6',
  },
  {
    id: 'json',
    name: 'JSON',
    extensions: ['.json', '.jsonc', '.json5'],
    category: 'config',
    color: '#ffd43b',
  },

  // 主流后端与通用语言
  {
    id: 'python',
    name: 'Python',
    extensions: ['.py', '.pyw', '.pyi'],
    category: 'code',
    color: '#3776ab',
  },
  {
    id: 'java',
    name: 'Java',
    extensions: ['.java', '.jav'],
    category: 'code',
    color: '#b07219',
  },
  {
    id: 'cpp',
    name: 'C/C++',
    extensions: ['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx', '.ino'],
    category: 'code',
    color: '#f34b7d',
  },
  {
    id: 'csharp',
    name: 'C#',
    extensions: ['.cs', '.csx'],
    category: 'code',
    color: '#178600',
  },
  {
    id: 'go',
    name: 'Go',
    extensions: ['.go'],
    category: 'code',
    color: '#00add8',
  },
  {
    id: 'rust',
    name: 'Rust',
    extensions: ['.rs'],
    category: 'code',
    color: '#dea584',
  },
  {
    id: 'php',
    name: 'PHP',
    extensions: ['.php', '.phtml'],
    category: 'code',
    color: '#4f5d95',
  },
  {
    id: 'ruby',
    name: 'Ruby',
    extensions: ['.rb'],
    category: 'code',
    color: '#701516',
  },
  {
    id: 'kotlin',
    name: 'Kotlin',
    extensions: ['.kt', '.kts'],
    category: 'code',
    color: '#a97bff',
  },
  {
    id: 'swift',
    name: 'Swift',
    extensions: ['.swift'],
    category: 'code',
    color: '#f05138',
  },

  // 脚本与自动化
  {
    id: 'shell',
    name: 'Shell',
    extensions: ['.sh', '.bash', '.zsh'],
    category: 'code',
    color: '#89e051',
  },
  {
    id: 'powershell',
    name: 'PowerShell',
    extensions: ['.ps1', '.psm1', '.psd1', '.bat', '.cmd'],
    category: 'code',
    color: '#012456',
  },

  // 配置与数据格式
  {
    id: 'sql',
    name: 'SQL',
    extensions: ['.sql'],
    category: 'config',
    color: '#e38c00',
  },
  {
    id: 'yaml',
    name: 'YAML',
    extensions: ['.yaml', '.yml'],
    category: 'config',
    color: '#cb171e',
  },
  {
    id: 'xml',
    name: 'XML',
    extensions: ['.xml', '.svg', '.plist', '.xaml'],
    category: 'config',
    color: '#0060ac',
  },
  {
    id: 'ini',
    name: 'INI / TOML',
    extensions: ['.ini', '.toml', '.env', '.conf', '.cfg', '.properties'],
    category: 'config',
    color: '#9c4221',
  },
  {
    id: 'graphql',
    name: 'GraphQL',
    extensions: ['.graphql', '.gql'],
    category: 'config',
    color: '#e10098',
  },
  {
    id: 'dockerfile',
    name: 'Dockerfile',
    extensions: ['.dockerfile'],
    filenames: ['Dockerfile', 'dockerfile', '.dockerignore'],
    category: 'config',
    color: '#384d54',
  },

  // 文档格式
  {
    id: 'markdown',
    name: 'Markdown',
    extensions: ['.md', '.markdown', '.mdx'],
    category: 'doc',
    color: '#083fa1',
  },
]

/** 扩展语言注册表（便于未来支持用户自定义注入） */
const customLanguages: LanguageAdapter[] = []

/** 注册新的自定义语言适配器 */
export function registerLanguage(adapter: LanguageAdapter): void {
  const idx = customLanguages.findIndex((l) => l.id === adapter.id)
  if (idx >= 0) customLanguages[idx] = adapter
  else customLanguages.push(adapter)
}

/** 获取全部已注册语言 */
export function listSupportedLanguages(): LanguageAdapter[] {
  return [...customLanguages, ...BUILTIN_LANGUAGES]
}

/** 根据文件名解析匹配的语言适配器 */
export function getLanguageByFilename(filename: string): LanguageAdapter | null {
  if (!filename) return null
  const clean = filename.trim().toLowerCase()
  const baseName = clean.split(/[\\/]/).pop() ?? clean

  const all = listSupportedLanguages()

  // 1. 优先精确匹配特定文件名（如 Dockerfile）
  for (const lang of all) {
    if (lang.filenames?.some((fn) => fn.toLowerCase() === baseName)) {
      return lang
    }
  }

  // 2. 匹配后缀
  for (const lang of all) {
    if (lang.extensions.some((ext) => clean.endsWith(ext.toLowerCase()))) {
      return lang
    }
  }

  return null
}

/** 供 Monaco Editor <Editor language={...} /> 使用的语言 ID 解析器 */
export function getLanguageIdByFilename(filename: string): string {
  const matched = getLanguageByFilename(filename)
  return matched ? matched.id : 'plaintext'
}

/** 供文件管理器 / 树视图获取视觉类别（code | config | doc | style | image | default） */
export function getFileCategory(filename: string): FileCategory {
  const clean = (filename ?? '').trim().toLowerCase()
  // 图片单独分流
  if (/\.(png|jpe?g|gif|webp|ico|bmp|tiff)$/i.test(clean)) {
    return 'image'
  }
  const matched = getLanguageByFilename(clean)
  return matched ? matched.category : 'default'
}

/** 在 Monaco 启动初始化时执行自定义语言注册 */
export function initCustomLanguages(monaco: typeof monacoType): void {
  for (const lang of listSupportedLanguages()) {
    if (lang.customSetup) {
      try {
        lang.customSetup(monaco)
      } catch (err) {
        console.warn(`[RingCode] 语言适配器 ${lang.name} 注册失败:`, err)
      }
    }
  }
}
