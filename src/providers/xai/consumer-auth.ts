import { z } from "zod"

import type { Clock } from "../../core/clock.js"
import { readXaiAccessState } from "./access-state.js"

const XAI_CONSUMER_MARKER = "cli-session:xai"
const XAI_DUMMY_API_KEY = "xai-access-file"
const XaiConsumerMarkerSchema = z
  .object({ type: z.literal("api"), key: z.literal(XAI_CONSUMER_MARKER) })
  .strict()

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
}

export class XaiAccessUnavailableError extends Error {
  public override readonly name = "XaiAccessUnavailableError"

  public constructor() {
    super("xAI consumer access is unavailable")
  }
}

function assertNeverAccessState(_state: never): never {
  throw new XaiAccessUnavailableError()
}

function createConsumerFetch(options: XaiConsumerAuthOptions): NetworkFetch {
  return async (input, init) => {
    const state = await readXaiAccessState({ env: options.env })
    let access: string
    switch (state.kind) {
      case "ready":
        if (state.expires <= options.clock.nowMs()) throw new XaiAccessUnavailableError()
        access = state.access
        break
      case "unavailable":
        throw new XaiAccessUnavailableError()
      default:
        return assertNeverAccessState(state)
    }
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    const initHeaders = new Headers(init?.headers)
    initHeaders.forEach((value, key) => {
      headers.set(key, value)
    })
    headers.set("authorization", `Bearer ${access}`)
    return options.networkFetch(input, init === undefined ? { headers } : { ...init, headers })
  }
}

export function createXaiConsumerAuth(options: XaiConsumerAuthOptions): XaiConsumerAuthHook {
  return {
    provider: "xai",
    loader: async (getAuth: () => Promise<unknown>) => {
      const marker = XaiConsumerMarkerSchema.safeParse(await getAuth())
      return marker.success
        ? { apiKey: XAI_DUMMY_API_KEY, fetch: createConsumerFetch(options) }
        : {}
    },
    methods: [],
  }
}
