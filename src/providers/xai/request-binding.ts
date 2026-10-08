import { createHash } from "node:crypto"

import type { Clock } from "../../core/clock.js"
import { readXaiAccessState, resolveXaiAccessPath } from "./access-state.js"

export class XaiAccessUnavailableError extends Error {
  public override readonly name = "XaiAccessUnavailableError"
  public constructor() {
    super("xAI consumer access is unavailable")
  }
}

export type XaiBindingOptions = {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly clock: Clock
  /** Host-selected connection check; never look up an alternative connection. */
  readonly gate?: () => boolean | Promise<boolean>
}

type AccessSnapshot = { readonly path: string; readonly access: string; readonly expires: number }

/** Opaque per-attempt identity: no bearer bytes survive the begin() read. */
export class XaiRequestBinding {
  readonly #owner: object
  readonly #path: string
  readonly #digest: string
  readonly #expires: number

  public constructor(owner: object, snapshot: AccessSnapshot) {
    this.#owner = owner
    this.#path = snapshot.path
    this.#digest = createHash("sha256").update(snapshot.access).digest("hex")
    this.#expires = snapshot.expires
    Object.freeze(this)
  }

  public matches(owner: object, snapshot: AccessSnapshot): boolean {
    return (
      this.#owner === owner &&
      this.#path === snapshot.path &&
      this.#expires === snapshot.expires &&
      this.#digest === createHash("sha256").update(snapshot.access).digest("hex")
    )
  }
}

export type XaiRequestBindings = {
  readonly signal: AbortSignal
  readonly begin: (signal?: AbortSignal) => Promise<XaiRequestBinding>
  readonly revalidate: (binding: XaiRequestBinding, signal?: AbortSignal) => Promise<string>
  readonly dispose: () => Promise<void>
}

export function createXaiRequestBindings(options: XaiBindingOptions): XaiRequestBindings {
  const owner = {}
  const lifetime = new AbortController()
  let disposed: Promise<void> | undefined

  function checkSignal(signal?: AbortSignal): void {
    lifetime.signal.throwIfAborted()
    signal?.throwIfAborted()
  }

  async function checkGate(signal?: AbortSignal): Promise<void> {
    checkSignal(signal)
    if (options.gate && !(await options.gate())) throw new XaiAccessUnavailableError()
    checkSignal(signal)
  }

  async function read(signal?: AbortSignal): Promise<AccessSnapshot> {
    await checkGate(signal)
    const path = resolveXaiAccessPath(options.env)
    if (path === null) throw new XaiAccessUnavailableError()
    const state = await readXaiAccessState({ env: options.env })
    checkSignal(signal)
    await checkGate(signal)
    if (
      resolveXaiAccessPath(options.env) !== path ||
      state.kind !== "ready" ||
      state.expires <= options.clock.nowMs()
    ) {
      throw new XaiAccessUnavailableError()
    }
    return { path, access: state.access, expires: state.expires }
  }

  return {
    signal: lifetime.signal,
    begin: async (signal) => {
      const state = await read(signal)
      return new XaiRequestBinding(owner, state)
    },
    revalidate: async (binding, signal) => {
      const state = await read(signal)
      if (!binding.matches(owner, state)) throw new XaiAccessUnavailableError()
      checkSignal(signal)
      return state.access
    },
    dispose: () => {
      if (disposed) return disposed
      lifetime.abort(new XaiAccessUnavailableError())
      disposed = Promise.resolve()
      return disposed
    },
  }
}
