import { expect, it } from "bun:test"
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
