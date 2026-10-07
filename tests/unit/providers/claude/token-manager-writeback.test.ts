import { expect, it } from "bun:test"
import { readClaudeCredentialSource } from "../../../../src/providers/claude/auth"
import { createClaudeTokenManager } from "../../../../src/providers/claude/token-manager"
import { FakeClock } from "../../../support/clock"
import { FakeHttpTransport } from "../../../support/http"
import { signal, stored, success } from "./token-manager-fixture"

it("invokes enabled writeback only for an unchanged observed source", async () => {
  // Given
  const transport = new FakeHttpTransport()
  transport.enqueueResponse(success("owned"))
  const written: string[] = []
  const manager = createClaudeTokenManager({
    env: {},
    clock: new FakeClock(),
    transport,
    lookup: { readKeychain: async () => stored("old") },
    writeBackEnabled: true,
    writeBack: async (credentials, previous) => {
      written.push(`${previous.credentials.accessToken}:${credentials.accessToken}`)
    },
  })
  // When
  const token = await manager.readAccessToken(signal)
  // Then
  expect(token).toBe("owned")
  expect(written).toEqual(["old:owned"])
})

it("does not cache a stale completion after writeback observes a foreign source", async () => {
  // Given
  let raw: string | null = stored("old")
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const transport = new FakeHttpTransport()
  transport.enqueueResponse(success("rotated"))
  const manager = createClaudeTokenManager({
    env: {},
    clock: new FakeClock(),
    transport,
    lookup: {
      readKeychain: async () => raw,
      readFile: async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" })
      },
    },
    writeBackEnabled: true,
    writeBack: async () => {
      entered.resolve()
      await release.promise
    },
  })
  const flight = manager.forceRefreshAccessToken(signal)
  await entered.promise
  // When
  raw = JSON.stringify({ accessToken: "foreign", refreshToken: "other", expiresAt: 3_600_000 })
  release.resolve()
  // Then
  expect(await flight).toBeNull()
  expect((await manager.readCredentialObservation(signal))?.credentials.accessToken).toBe("foreign")
})

it("does not restore a removed source after delayed writeback", async () => {
  // Given
  let raw: string | null = stored("old")
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const transport = new FakeHttpTransport()
  transport.enqueueResponse(success("rotated"))
  const manager = createClaudeTokenManager({
    env: {},
    clock: new FakeClock(),
    transport,
    lookup: {
      readKeychain: async () => raw,
      readFile: async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" })
      },
    },
    writeBackEnabled: true,
    writeBack: async () => {
      entered.resolve()
      await release.promise
    },
  })
  const flight = manager.forceRefreshAccessToken(signal)
  await entered.promise
  // When
  raw = null
  release.resolve()
  // Then
  expect(await flight).toBeNull()
  expect(await manager.readCredentialObservation(signal)).toBeNull()
})

it("keeps the lineage of an owned writeback persisted to the source", async () => {
  // Given
  let raw = JSON.stringify({ accessToken: "old", refreshToken: "prior", expiresAt: 10_000 })
  const clock = new FakeClock(-100_000)
  const transport = new FakeHttpTransport()
  transport.enqueueResponse(success("rotated"))
  const manager = createClaudeTokenManager({
    env: {},
    clock,
    transport,
    lookup: { readKeychain: async () => raw },
    writeBackEnabled: true,
    writeBack: async (credentials) => {
      raw = JSON.stringify({
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        expiresAt: credentials.expiresAtMs,
      })
    },
  })
  const before = await manager.readCredentialObservation(signal)
  // When
  clock.advanceBy(100_000)
  const token = await manager.forceRefreshAccessToken(signal)
  // Then
  expect(token).toBe("rotated")
  expect((await manager.readCredentialObservation(signal))?.lineageId).toBe(before?.lineageId)
})

it("persists two successive automatic renewals with rotated refresh tokens in one lineage", async () => {
  // Given
  let raw = stored("old", "prior")
  const clock = new FakeClock()
  const transport = new FakeHttpTransport()
  for (const [accessToken, refreshToken] of [
    ["first", "rotated-once"],
    ["second", "rotated-twice"],
  ]) {
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(
        JSON.stringify({
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: 3600,
        }),
      ),
    })
  }
  const lookup = { readKeychain: async () => raw }
  const before = await readClaudeCredentialSource({}, signal, lookup)
  const written: string[] = []
  const manager = createClaudeTokenManager({
    env: {},
    clock,
    transport,
    lookup,
    writeBackEnabled: true,
    writeBack: async (credentials, previous) => {
      written.push(`${previous.credentials.refreshToken}:${credentials.refreshToken}`)
      raw = JSON.stringify({
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        expiresAt: credentials.expiresAtMs,
      })
    },
  })
  // When
  const first = await manager.readCredentialObservation(signal)
  const persistedFirst = await readClaudeCredentialSource({}, signal, lookup)
  clock.advanceBy(3_540_000)
  const second = await manager.readCredentialObservation(signal)
  const persistedSecond = await readClaudeCredentialSource({}, signal, lookup)
  // Then
  expect(first?.credentials.accessToken).toBe("first")
  expect(first?.revision).toBe(persistedFirst?.revision)
  expect(first?.revision).not.toBe(before?.revision)
  expect(second?.credentials.accessToken).toBe("second")
  expect(second?.credentials.refreshToken).toBe("rotated-twice")
  expect(second?.revision).toBe(persistedSecond?.revision)
  expect(second?.revision).not.toBe(first?.revision)
  expect(second?.lineageId).toBe(first?.lineageId)
  expect(persistedSecond?.credentials.refreshToken).toBe("rotated-twice")
  expect(written).toEqual(["prior:rotated-once", "rotated-once:rotated-twice"])
  expect(
    transport.requests.map(({ body }) =>
      new URLSearchParams(new TextDecoder().decode(body ?? undefined)).get("refresh_token"),
    ),
  ).toEqual(["prior", "rotated-once"])
})
