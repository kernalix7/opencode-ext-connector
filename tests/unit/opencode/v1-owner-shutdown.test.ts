import { expect, it } from "bun:test"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { OperationCancelledError } from "../../../src/core/errors"

import type { HttpTransport } from "../../../src/core/http"
import { createProviderRegistry } from "../../../src/opencode/providers"
import { createV1CatalogProjector } from "../../../src/opencode/v1-catalog"
import { createV1Owner } from "../../../src/opencode/v1-owner"
import { nativeFixture } from "./native-claude-fixture"

it("aborts the shared refresh before draining and preserves a genuine refresh rejection", async () => {
  // Given
  const state = await nativeFixture()
  const started = Promise.withResolvers<AbortSignal>()
  const pending = Promise.withResolvers<never>()
  const failure = new TypeError("synthetic refresh failure")
  const adapterFailure = new TypeError("synthetic adapter cleanup failure")
  let adapterDisposals = 0
  const transport: HttpTransport = {
    request: async (request, signal) => {
      if (new URL(request.url).hostname !== "claude.ai")
        return state.transport.request(request, signal)
      started.resolve(signal)
      return pending.promise
    },
  }
  const entries = createProviderRegistry()
    .filter((entry) => entry.id !== "ollama")
    .reverse()
    .map((entry) =>
      entry.id === "claude"
        ? entry
        : {
            ...entry,
            createAdapter: (deps: typeof state.deps) => {
              const adapter = entry.createAdapter(deps)
              const dispose = async () => {
                adapterDisposals += 1
                await adapter.dispose()
                throw adapterFailure
              }
              return { ...adapter, dispose, [Symbol.asyncDispose]: dispose }
            },
          },
    )
  const projector = createV1CatalogProjector({ entries, npmSpecifiers: {} })
  const owner = createV1Owner({
    entries,
    deps: { ...state.deps, transport },
    projector,
    health: { initialBackoffMs: 1000, maximumBackoffMs: 1000 },
    logger: { log: () => undefined },
    snapshotTimeoutMs: 30_000,
    lifetime: new AbortController().signal,
  })
  try {
    await writeFile(
      join(state.home, "opencode", "auth.json"),
      JSON.stringify({
        anthropic: { type: "api", key: "cli-session:anthropic" },
        "command-code": { type: "api", key: "synthetic-command" },
      }),
    )
    state.transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode('{"data":[{"id":"command-model"}]}'),
    })
    await state.credentials("synthetic-native", 0)
    const refreshing = owner.refresh().then(
      () => undefined,
      (error: unknown) => error,
    )
    const refreshSignal = await started.promise
    // When
    const cleanup = owner.dispose()
    const abortedBeforeDrain = refreshSignal.aborted
    const repeated = owner.dispose()
    pending.reject(failure)
    const refreshError = await refreshing
    const cleanupError: unknown = await cleanup.then(
      () => undefined,
      (error: unknown) => error,
    )
    // Then
    expect(abortedBeforeDrain).toBe(true)
    expect(repeated).toBe(cleanup)
    expect(refreshError).toBeInstanceOf(OperationCancelledError)
    expect(cleanupError).toBeInstanceOf(AggregateError)
    if (!(cleanupError instanceof AggregateError)) throw new TypeError("Expected cleanup failure")
    expect(cleanupError.errors).toContain(failure)
    expect(cleanupError.errors).toContain(adapterFailure)
    expect(adapterDisposals).toBe(1)
  } finally {
    await state.dispose()
  }
})

it("prevents late credential writeback when shutdown drains an owned refresh", async () => {
  // Given
  const state = await nativeFixture()
  const started = Promise.withResolvers<AbortSignal>()
  const pending = Promise.withResolvers<Awaited<ReturnType<HttpTransport["request"]>>>()
  const entries = createProviderRegistry().filter((entry) => entry.id === "claude")
  const owner = createV1Owner({
    entries,
    deps: {
      ...state.deps,
      writeBackCredentials: true,
      transport: {
        request: async (_request, signal) => {
          started.resolve(signal)
          return pending.promise
        },
      },
    },
    projector: createV1CatalogProjector({ entries, npmSpecifiers: {} }),
    health: { initialBackoffMs: 1000, maximumBackoffMs: 1000 },
    logger: { log: () => undefined },
    snapshotTimeoutMs: 30_000,
    lifetime: new AbortController().signal,
  })
  try {
    await state.credentials("synthetic-native", 0)
    const original = await readFile(state.credentialsPath, "utf8")
    const refreshing = owner.refresh().then(
      () => undefined,
      (error: unknown) => error,
    )
    const signal = await started.promise
    // When
    const cleanup = owner.dispose()
    pending.resolve({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(
        '{"access_token":"late-token","refresh_token":"late-refresh","expires_at":1900000000000}',
      ),
    })
    await cleanup
    await refreshing
    // Then
    expect(signal.aborted).toBe(true)
    expect(await readFile(state.credentialsPath, "utf8")).toBe(original)
    await owner.refresh()
    expect(state.transport.requests).toHaveLength(0)
  } finally {
    await state.dispose()
  }
})
