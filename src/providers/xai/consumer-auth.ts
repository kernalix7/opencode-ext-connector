import { z } from "zod"

import type { Clock } from "../../core/clock.js"
import { createXaiRequestBindings, XaiAccessUnavailableError } from "./request-binding.js"
import { assertXaiTarget } from "./targets.js"

const Marker = z.object({ type: z.literal("api"), key: z.literal("cli-session:xai") }).strict()

export type NetworkFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
export type XaiConsumerAuthOptions = {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly clock: Clock
  readonly networkFetch: NetworkFetch
}
export type XaiConsumerAuthHook = {
  readonly provider: "xai"
  readonly loader: (
    getAuth: () => Promise<unknown>,
  ) => Promise<
    | { readonly apiKey: string; readonly fetch: NetworkFetch }
    | { readonly apiKey?: never; readonly fetch?: never }
  >
  readonly methods: []
  readonly dispose: () => Promise<void>
}
export { XaiAccessUnavailableError } from "./request-binding.js"

export function createXaiConsumerAuth(options: XaiConsumerAuthOptions): XaiConsumerAuthHook {
  const lifetime = new AbortController()
  const loaders = new Set<() => Promise<void>>()
  let disposed: Promise<void> | undefined
  return {
    provider: "xai",
    methods: [],
    loader: async (getAuth) => {
      lifetime.signal.throwIfAborted()
      if (!Marker.safeParse(await getAuth()).success) return {}
      lifetime.signal.throwIfAborted()
      const binding = createXaiRequestBindings({
        env: options.env,
        clock: options.clock,
        gate: async () => !lifetime.signal.aborted && Marker.safeParse(await getAuth()).success,
      })
      loaders.add(binding.dispose)
      const consumerFetch: NetworkFetch = async (input, init) => {
        assertXaiTarget(input, "http")
        const requestSignal = input instanceof Request ? input.signal : undefined
        const signal = AbortSignal.any([
          lifetime.signal,
          binding.signal,
          ...[requestSignal, init?.signal].filter(
            (value): value is AbortSignal => value !== undefined && value !== null,
          ),
        ])
        signal.throwIfAborted()
        const attempt = await binding.begin(signal)
        const headers = new Headers(input instanceof Request ? input.headers : undefined)
        new Headers(init?.headers).forEach((value, key) => {
          headers.set(key, value)
        })
        const access = await binding.revalidate(attempt, signal)
        headers.set("authorization", `Bearer ${access}`)
        signal.throwIfAborted()
        assertXaiTarget(input, "http")
        // No redirect can carry the bearer beyond the validated origin.
        return options.networkFetch(input, { ...init, headers, redirect: "error", signal })
      }
      return { apiKey: "xai-access-file", fetch: consumerFetch }
    },
    dispose: () => {
      if (disposed) return disposed
      lifetime.abort(new XaiAccessUnavailableError())
      disposed = Promise.all([...loaders].map((close) => close())).then(() => undefined)
      loaders.clear()
      return disposed
    },
  }
}
