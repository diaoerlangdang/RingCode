export interface TerminalTarget {
  paste: (text: string) => boolean | void
  focus: () => void
  dispose?: () => void
}

class TerminalRegistry {
  private targets = new Map<string, TerminalTarget>()

  register(id: string, target: TerminalTarget): () => void {
    this.targets.set(id, target)
    return () => {
      if (this.targets.get(id) === target) {
        this.targets.delete(id)
      }
    }
  }

  get(id: string): TerminalTarget | undefined {
    return this.targets.get(id)
  }

  pasteTo(id: string, text: string): boolean {
    const target = this.targets.get(id)
    if (!target) return false
    target.focus()
    return target.paste(text) !== false
  }

  clear(): void {
    this.targets.clear()
  }
}

export const terminalRegistry = new TerminalRegistry()
export const registerTerminalTarget = (id: string, target: TerminalTarget): (() => void) =>
  terminalRegistry.register(id, target)
export const pasteToTerminal = (id: string, text: string): boolean =>
  terminalRegistry.pasteTo(id, text)
