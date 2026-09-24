/** Stop polling native history once the RingCode session has been linked. */
export function createNativeSessionLookup(lookup: () => Promise<boolean>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight = false
  let linked = false
  let disposed = false

  const run = async () => {
    if (disposed || linked || inFlight) return
    inFlight = true
    try {
      linked = await lookup()
      if (linked && timer) clearTimeout(timer)
    } finally {
      inFlight = false
    }
  }

  return {
    schedule(delay: number) {
      if (disposed || linked) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        void run()
      }, delay)
    },
    run,
    dispose() {
      disposed = true
      if (timer) clearTimeout(timer)
    },
  }
}
