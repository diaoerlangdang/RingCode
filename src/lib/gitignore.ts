// Pragmatic .gitignore 过滤器（FIL-008）：解析根目录 .gitignore，
// 对文件管理器条目按 basename 匹配。支持 *、**、?、! 取反、dir/ 目录限定，
// 采用 last-match-wins 语义。路径内含 / 的复杂模式按 basename 退化匹配（宁可多显示）。
import { readTextFile } from './fs'
import type { DirHandle } from './fs'

interface Rule {
  re: RegExp
  negate: boolean
  dirOnly: boolean
}

/** 把单个 glob 模式转为正则（已去除 ! 前缀和尾部 /） */
function globToRegex(pattern: string): RegExp {
  let s = pattern
  if (s.startsWith('/')) s = s.slice(1) // 根锚定按当前目录相对处理
  let out = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '*') {
      if (s[i + 1] === '*') {
        out += '.*'
        i += 2
        if (s[i] === '/') i++
      } else {
        out += '[^/]*'
        i++
      }
    } else if (c === '?') {
      out += '[^/]'
      i++
    } else if ('.+^$(){}|[]\\'.includes(c)) {
      out += '\\' + c
      i++
    } else {
      out += c
      i++
    }
  }
  return new RegExp('^' + out + '$')
}

function parseIgnore(text: string): Rule[] {
  const rules: Rule[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    let p = line
    let negate = false
    if (p.startsWith('!')) {
      negate = true
      p = p.slice(1)
    }
    let dirOnly = false
    if (p.endsWith('/')) {
      dirOnly = true
      p = p.slice(0, -1)
    }
    if (!p) continue
    rules.push({ re: globToRegex(p), negate, dirOnly })
  }
  return rules
}

export type IgnoreMatcher = (name: string, isDir: boolean) => boolean

export function compileRules(rules: Rule[]): IgnoreMatcher {
  return (name, isDir) => {
    let ignored = false
    for (const r of rules) {
      if (r.dirOnly && !isDir) continue
      if (r.re.test(name)) ignored = !r.negate
    }
    return ignored
  }
}

/** 读取工作区根 .gitignore 并构建匹配器；失败或无文件返回 null */
export async function loadIgnoreMatcher(handle: DirHandle): Promise<IgnoreMatcher | null> {
  try {
    const text = await readTextFile(handle, ['.gitignore'])
    if (!text) return null
    return compileRules(parseIgnore(text))
  } catch {
    return null
  }
}

/** 始终忽略的内部目录（不受"显示忽略项"开关影响） */
export const ALWAYS_IGNORE = new Set(['.git'])
