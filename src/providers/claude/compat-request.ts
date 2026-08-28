// Derived from griffinmartin/opencode-claude-auth@0f0ff6f12c367339130cbfd250393863ed2c8d9e.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import { randomUUID } from "node:crypto"

import {
  claudeModelBetas,
  excludeClaudeBeta,
  isClaudeLongContextError,
  nextClaudeBetaToExclude,
} from "./compat-betas"
import { transformClaudeResponse } from "./compat-response"
import { transformClaudeBody } from "./compat-transform"

const sessionId = randomUUID()

function requestUrl(input: string | URL | Request): string | URL {
  const raw =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
  const url = new URL(raw)
  if (url.pathname === "/v1/messages" && !url.searchParams.has("beta")) {
    url.searchParams.set("beta", "true")
  }
  return typeof input === "string" ? url.toString() : url
}

function modelFromBody(body: RequestInit["body"]): string {
  if (typeof body !== "string") {
    return "unknown"
  }
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed === "object" && parsed !== null && "model" in parsed) {
      const model = Reflect.get(parsed, "model")
      return typeof model === "string" ? model : "unknown"
    }
  } catch {}
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
    .filter((value) => value.length > 0)
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
  for (const [key, value] of Object.entries(stainless)) {
    if (!headers.has(key)) {
      headers.set(key, value)
    }
  }
  headers.delete("x-api-key")
  return headers
}

function maxRetryDelayMs(): number {
  const value = Number.parseInt(process.env["OPENCODE_CLAUDE_AUTH_MAX_RETRY_MS"] ?? "", 10)
  return Number.isFinite(value) && value > 0 ? value : 30_000
}

async function sleepUnlessAborted(ms: number, signal?: AbortSignal | null): Promise<void> {
  await new Promise<void>((resolve) => {
    if (signal?.aborted === true) {
      resolve()
      return
    }
    const finish = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal?.addEventListener("abort", finish, { once: true })
  })
}

async function fetchWithRetry(input: string | URL | Request, init: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await globalThis.fetch(input, init)
    if ((response.status !== 429 && response.status !== 529) || attempt === 2) {
      return response
    }
    const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10)
    const delay = Number.isFinite(retryAfter) ? retryAfter * 1_000 : (attempt + 1) * 2_000
    if (delay > maxRetryDelayMs()) {
      return response
    }
    await sleepUnlessAborted(delay, init.signal)
    if (init.signal?.aborted === true) {
      return response
    }
  }
  return globalThis.fetch(input, init)
}

export function createClaudeCompatibilityFetch(options: {
  readonly version: string
  readonly readAccessToken: (signal: AbortSignal) => Promise<string | null>
  readonly forceRefreshAccessToken: (signal: AbortSignal) => Promise<string | null>
}): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input, requestInit = {}) => {
    const signal = requestInit.signal ?? new AbortController().signal
    let token = await options.readAccessToken(signal)
    if (token === null) {
      throw new Error("Claude Code credentials are unavailable or expired. Run `claude` to log in.")
    }
    const modelId = modelFromBody(requestInit.body)
    const body = transformClaudeBody(requestInit.body, options.version)
    const url = requestUrl(input)
    const send = (accessToken: string): Promise<Response> => {
      const incoming = new Headers(input instanceof Request ? input.headers : undefined)
      new Headers(requestInit.headers).forEach((value, key) => {
        incoming.set(key, value)
      })
      return fetchWithRetry(url, {
        ...requestInit,
        body,
        headers: createClaudeCompatibilityHeaders({
          accessToken,
          modelId,
          version: options.version,
          incoming,
        }),
      })
    }
    let response = await send(token)
    if (response.status === 401) {
      const refreshed = await options.forceRefreshAccessToken(signal)
      if (refreshed !== null) {
        token = refreshed
        response = await send(refreshed)
      }
    }
    for (let attempt = 0; !response.ok && attempt < 2; attempt += 1) {
      const bodyText = await response.clone().text()
      if (!isClaudeLongContextError(bodyText)) {
        break
      }
      const excluded = nextClaudeBetaToExclude(modelId)
      if (excluded === null) {
        break
      }
      excludeClaudeBeta(modelId, excluded)
      response = await send(token)
    }
    return transformClaudeResponse(response)
  }
}
