// Derived from griffinmartin/opencode-claude-auth@0f0ff6f12c367339130cbfd250393863ed2c8d9e.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import { randomUUID } from "node:crypto"
import { AdapterError, OperationCancelledError } from "../../core/errors.js"
import { parseProviderId } from "../../core/ids.js"
import {
  claudeModelBetas,
  excludeClaudeBeta,
  isClaudeLongContextError,
  nextClaudeBetaToExclude,
} from "./compat-betas.js"
import { transformClaudeResponse } from "./compat-response.js"
import { transformClaudeBody } from "./compat-transform.js"

const sessionId = randomUUID()

function requestUrl(input: string | URL | Request): string {
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
  )
  if (url.pathname === "/v1/messages" && !url.searchParams.has("beta"))
    url.searchParams.set("beta", "true")
  return url.toString()
}

function modelFromBody(body: RequestInit["body"]): string {
  if (typeof body !== "string") return "unknown"
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch (error) {
    if (error instanceof SyntaxError) return "unknown"
    throw error
  }
  if (typeof parsed === "object" && parsed !== null && "model" in parsed) {
    const model = Reflect.get(parsed, "model")
    return typeof model === "string" ? model : "unknown"
  }
  return "unknown"
}

export type ClaudeCompatibilityHeaderOptions = {
  readonly accessToken: string
  readonly modelId: string
  readonly version: string
  readonly incoming?: Headers
}

export function createClaudeCompatibilityHeaders(
  options: ClaudeCompatibilityHeaderOptions,
): Headers {
  const headers = new Headers(options.incoming)
  const incoming = (headers.get("anthropic-beta") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  headers.set("authorization", `Bearer ${options.accessToken}`)
  headers.set("anthropic-version", "2023-06-01")
  headers.set(
    "anthropic-beta",
    [...new Set([...claudeModelBetas(options.modelId), ...incoming])].join(","),
  )
  headers.set("anthropic-dangerous-direct-browser-access", "true")
  headers.set("x-app", "cli")
  headers.set(
    "user-agent",
    process.env["ANTHROPIC_USER_AGENT"] ?? `claude-cli/${options.version} (external, sdk-cli)`,
  )
  headers.set("x-client-request-id", randomUUID())
  headers.set("X-Claude-Code-Session-Id", sessionId)
  const stainless: Readonly<Record<string, string>> = {
    "x-stainless-arch": process.arch === "arm64" ? "arm64" : process.arch,
    "x-stainless-lang": "js",
    "x-stainless-os": process.platform === "darwin" ? "MacOS" : process.platform,
    "x-stainless-package-version": "0.81.0",
    "x-stainless-retry-count": "0",
    "x-stainless-runtime": "node",
    "x-stainless-runtime-version": process.version,
    "x-stainless-timeout": "600",
  }
  for (const [key, value] of Object.entries(stainless))
    if (!headers.has(key)) headers.set(key, value)
  headers.delete("x-api-key")
  return headers
}

function maxRetryDelayMs(): number {
  const value = Number.parseInt(process.env["OPENCODE_CLAUDE_AUTH_MAX_RETRY_MS"] ?? "", 10)
  return Number.isFinite(value) && value > 0 ? value : 30_000
}

async function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new OperationCancelledError("claude-request")
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      signal.removeEventListener("abort", finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener("abort", finish, { once: true })
  })
  if (signal.aborted) throw new OperationCancelledError("claude-request")
}

export type ClaudeCompatibilityFetchOptions = {
  readonly readVersion: (signal: AbortSignal) => Promise<string | null>
  readonly readAccessToken: (signal: AbortSignal) => Promise<string | null>
  readonly forceRefreshAccessToken: (signal: AbortSignal) => Promise<string | null>
  readonly fetch?: typeof globalThis.fetch
}

export function createClaudeCompatibilityFetch(
  options: ClaudeCompatibilityFetchOptions,
): typeof globalThis.fetch {
  const fetch = options.fetch ?? globalThis.fetch
  const compatFetch = async (
    input: string | URL | Request,
    requestInit: RequestInit = {},
  ): Promise<Response> => {
    const signal =
      requestInit.signal ?? (input instanceof Request ? input.signal : new AbortController().signal)
    const active = (): void => {
      if (signal.aborted) throw new OperationCancelledError("claude-request")
    }
    active()
    let token = await options.readAccessToken(signal)
    active()
    if (!token)
      throw new AdapterError({
        operation: "claude-credentials",
        providerId: parseProviderId("claude"),
        retryable: false,
        cause: null,
      })
    const version = await options.readVersion(signal)
    active()
    if (!version)
      throw new AdapterError({
        operation: "claude-version",
        providerId: parseProviderId("claude"),
        retryable: false,
        cause: null,
      })
    const modelId = modelFromBody(requestInit.body)
    const body = transformClaudeBody(requestInit.body, version)
    const url = requestUrl(input)
    const incoming = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(requestInit.headers).forEach((value, key) => {
      incoming.set(key, value)
    })
    const send = async (accessToken: string): Promise<Response> => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        active()
        const response = await fetch(url, {
          ...requestInit,
          signal,
          body,
          headers: createClaudeCompatibilityHeaders({ accessToken, modelId, version, incoming }),
        })
        active()
        if ((response.status !== 429 && response.status !== 529) || attempt === 2) return response
        const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10)
        const delay = Number.isFinite(retryAfter) ? retryAfter * 1_000 : (attempt + 1) * 2_000
        if (delay > maxRetryDelayMs()) return response
        await response.body?.cancel()
        await sleepUnlessAborted(delay, signal)
      }
      throw new AdapterError({
        operation: "claude-retry",
        providerId: parseProviderId("claude"),
        retryable: false,
        cause: null,
      })
    }
    let response = await send(token)
    if (response.status === 401) {
      const refreshed = await options.forceRefreshAccessToken(signal)
      active()
      if (refreshed !== null && refreshed !== token) {
        await response.body?.cancel()
        token = refreshed
        response = await send(refreshed)
      }
    }
    for (let attempt = 0; !response.ok && attempt < 2; attempt += 1) {
      active()
      const bodyText = await response.clone().text()
      active()
      if (!isClaudeLongContextError(bodyText)) break
      const excluded = nextClaudeBetaToExclude(modelId)
      if (excluded === null) break
      excludeClaudeBeta(modelId, excluded)
      await response.body?.cancel()
      response = await send(token)
    }
    active()
    return transformClaudeResponse(response, signal)
  }
  return Object.assign(compatFetch, { preconnect: fetch.preconnect })
}
