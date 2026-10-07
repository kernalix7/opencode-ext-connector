import { expect, it } from "bun:test"
import { OperationCancelledError } from "../../../../src/core/errors"
import { createClaudeTokenManager } from "../../../../src/providers/claude/token-manager"
import { FakeClock } from "../../../support/clock"
import { FakeHttpTransport } from "../../../support/http"
import { signal, stored, success } from "./token-manager-fixture"

async function started(transport: FakeHttpTransport): Promise<void> {
  for (let turn = 0; turn < 30 && transport.requests.length === 0; turn += 1)
    await Promise.resolve()
  expect(transport.requests).toHaveLength(1)
}

it("rereads only the source in never mode and revokes missing credentials", async () => {
  // Given
  let raw: string | null = stored("first")
  const transport = new FakeHttpTransport()
  const manager = createClaudeTokenManager({
    env: {},
    clock: new FakeClock(),
    transport,
    refresh: { mode: "never", leadMs: 60_000 },
    lookup: {
      readKeychain: async () => raw,
      readFile: async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" })
      },
    },
  })
  const first = await manager.readCredentialObservation(signal)
  // When
  raw = stored("second")
  const changed = await manager.forceRefreshAccessToken(signal)
  const second = await manager.readCredentialObservation(signal)
  raw = null
  const missing = await manager.readCredentialObservation(signal)
  // Then
  expect(changed).toBe("second")
  expect(second?.lineageId).not.toBe(first?.lineageId)
  expect(missing).toBeNull()
  expect(await manager.forceRefreshAccessToken(signal)).toBeNull()
  expect(transport.requests).toHaveLength(0)
})

it("singleflights refresh, keeps its lineage and never writes without capability", async () => {
  // Given
  const transport = new FakeHttpTransport()
  const pending = transport.enqueuePending()
  const written: string[] = []
  const clock = new FakeClock(-120_000)
  const manager = createClaudeTokenManager({
    env: {},
    clock,
    transport,
    lookup: { readKeychain: async () => stored("first") },
    writeBack: async (credentials) => {
      written.push(credentials.accessToken)
    },
  })
  const before = await manager.readCredentialObservation(signal)
  // When
  clock.advanceBy(120_000)
  const a = manager.forceRefreshAccessToken(signal)
  const b = manager.forceRefreshAccessToken(signal)
  await started(transport)
  pending.resolve(success("second"))
  // Then
  expect(await Promise.all([a, b])).toEqual(["second", "second"])
  expect((await manager.readCredentialObservation(signal))?.lineageId).toBe(before?.lineageId)
  expect(transport.requests).toHaveLength(1)
  expect(written).toEqual([])
})

it("drops a refresh completion after the source changes", async () => {
  // Given
  let raw = stored("first")
  const transport = new FakeHttpTransport()
  const pending = transport.enqueuePending()
  const clock = new FakeClock(-120_000)
  const manager = createClaudeTokenManager({
    env: {},
    clock,
    transport,
    lookup: { readKeychain: async () => raw },
  })
  const before = await manager.readCredentialObservation(signal)
  clock.advanceBy(120_000)
  const flight = manager.forceRefreshAccessToken(signal)
  // When
  await started(transport)
  raw = JSON.stringify({
    accessToken: "foreign",
    refreshToken: "foreign-refresh",
    expiresAt: 3_600_000,
  })
  pending.resolve(success("obsolete"))
  // Then
  expect(await flight).toBeNull()
  const after = await manager.readCredentialObservation(signal)
  expect(after?.credentials.accessToken).toBe("foreign")
  expect(after?.lineageId).not.toBe(before?.lineageId)
})

it("rejects late completions after disposal", async () => {
  // Given
  const transport = new FakeHttpTransport()
  const pending = transport.enqueuePending()
  const manager = createClaudeTokenManager({
    env: {},
    clock: new FakeClock(),
    transport,
    lookup: { readKeychain: async () => stored("first") },
  })
  const flight = manager.forceRefreshAccessToken(signal)
  // When
  const disposing = manager.dispose()
  pending.resolve(success("obsolete"))
  // Then
  await disposing
  await expect(flight).rejects.toThrow()
  await expect(manager.readCredentialObservation(signal)).rejects.toThrow()
})

it("backs off transient refresh failures on the injected clock", async () => {
  // Given
  const clock = new FakeClock()
  const transport = new FakeHttpTransport()
  transport.enqueueResponse({
    status: 503,
    headers: {},
    body: new TextEncoder().encode('{"error":"unavailable"}'),
  })
  transport.enqueueResponse(success("recovered"))
  const manager = createClaudeTokenManager({
    env: {},
    clock,
    transport,
    lookup: {
      readKeychain: async () =>
        JSON.stringify({ accessToken: "old", refreshToken: "refresh", expiresAt: 20_000 }),
    },
  })
  // When
  const first = await manager.readAccessToken(signal)
  const throttled = await manager.forceRefreshAccessToken(signal)
  clock.advanceBy(15_000)
  const recovered = await manager.forceRefreshAccessToken(signal)
  // Then
  expect(first).toBe("old")
  expect(throttled).toBeNull()
  expect(recovered).toBe("recovered")
  expect(transport.requests).toHaveLength(2)
})

it("keeps shared refresh alive when its first caller cancels", async () => {
  // Given
  const transport = new FakeHttpTransport()
  const pending = transport.enqueuePending()
  const firstSignal = new AbortController()
  const manager = createClaudeTokenManager({
    env: {},
    clock: new FakeClock(),
    transport,
    lookup: { readKeychain: async () => stored("old") },
  })
  const first = manager.forceRefreshAccessToken(firstSignal.signal)
  const second = manager.forceRefreshAccessToken(signal)
  await started(transport)
  // When
  firstSignal.abort()
  // Then
  await expect(first).rejects.toBeInstanceOf(OperationCancelledError)
  pending.resolve(success("new"))
  expect(await second).toBe("new")
  expect(transport.requests).toHaveLength(1)
})

it("shares the same disposal promise and cancels pending I/O", async () => {
  // Given
  const transport = new FakeHttpTransport()
  transport.enqueuePending()
  const manager = createClaudeTokenManager({
    env: {},
    clock: new FakeClock(),
    transport,
    lookup: { readKeychain: async () => stored("old") },
  })
  const flight = manager.forceRefreshAccessToken(signal)
  await started(transport)
  // When
  const cleanup = manager.dispose()
  // Then
  expect(manager.dispose()).toBe(cleanup)
  expect(manager[Symbol.asyncDispose]()).toBe(cleanup)
  await cleanup
  await expect(flight).rejects.toBeInstanceOf(OperationCancelledError)
})

it("does not return an expired cached token after renewal fails", async () => {
  // Given
  const transport = new FakeHttpTransport()
  transport.enqueueResponse({ status: 503, headers: {}, body: new TextEncoder().encode("{}") })
  const manager = createClaudeTokenManager({
    env: {},
    clock: new FakeClock(),
    transport,
    lookup: { readKeychain: async () => stored("expired") },
  })
  // When
  const token = await manager.readAccessToken(signal)
  // Then
  expect(token).toBeNull()
})
