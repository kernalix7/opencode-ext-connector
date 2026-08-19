export function bindProcessExit(
  dispose: () => Promise<void>,
  emitter: {
    readonly once: (event: string, listener: () => void) => void
    readonly off?: (event: string, listener: () => void) => void
  } = process,
): () => void {
  let ran = false
  const listener = (): void => {
    if (ran) {
      return
    }
    ran = true
    void dispose()
  }
  const events = ["beforeExit", "SIGINT", "SIGTERM"]
  for (const event of events) {
    emitter.once(event, listener)
  }
  return (): void => {
    ran = true
    if (emitter.off !== undefined) {
      for (const event of events) {
        emitter.off(event, listener)
      }
    }
  }
}
