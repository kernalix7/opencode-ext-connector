import { expect, it } from "bun:test"
import { rm } from "node:fs/promises"

import { OperationCancelledError } from "../../../src/core/errors"
import { nativeFixture, nativeRequest, nativeUrl } from "./native-claude-fixture"

it("uses the injected transport and vendor bearer for the actual native loader", async () => {
  // Given
  const state = await nativeFixture()
  try {
    const fetch = await state.fetch()
    state.transport.enqueueResponse({ status: 200, headers: {}, body: new Uint8Array() })
    // When
    await fetch(nativeUrl, nativeRequest)
    // Then
    expect(state.transport.requests).toHaveLength(1)
    expect(state.transport.requests[0]?.headers["authorization"]).toBe("Bearer synthetic-native")
    expect(state.transport.requests[0]?.headers["x-api-key"]).toBeUndefined()
  } finally {
    await state.dispose()
  }
})

for (const key of ["synthetic-api-key", "cli-session:claude", "cli-session:command-code"]) {
  it(`refuses native loading when the selected gate is ${key}`, async () => {
    // Given
    const state = await nativeFixture()
    try {
      state.select({ type: "api", key })
      // When
      const result = await state.load()
      // Then
      expect(result).toEqual({})
      expect(state.transport.requests).toHaveLength(0)
    } finally {
      await state.dispose()
    }
  })
}

for (const change of [
  "source-missing",
  "source-rotation",
  "gate",
  "membership",
  "dispose",
  "cancel",
] as const) {
  it(`revokes native dispatch when ${change} changes`, async () => {
    // Given
    const state = await nativeFixture()
    try {
      const fetch = await state.fetch()
      const controller = new AbortController()
      switch (change) {
        case "source-missing":
          await rm(state.credentialsPath)
          break
        case "source-rotation":
          await state.credentials("foreign-token")
          break
        case "gate":
          await state.gate({ type: "api", key: "foreign-key" })
          break
        case "membership":
          delete state.provider.models["fixture-model"]
          break
        case "dispose":
          await state.scoped.dispose()
          break
        case "cancel":
          controller.abort()
          break
        default:
          change satisfies never
      }
      // When / Then
      await expect(
        fetch(nativeUrl, { ...nativeRequest, signal: controller.signal }),
      ).rejects.toBeInstanceOf(OperationCancelledError)
      expect(state.transport.requests).toHaveLength(0)
    } finally {
      await state.dispose()
    }
  })
}

for (const url of [
  "https://foreign.test/v1/messages",
  "https://api.anthropic.com/v1/models",
  "https://user:password@api.anthropic.com/v1/messages",
]) {
  it(`rejects an untrusted native target before any transport call: ${url}`, async () => {
    // Given
    const state = await nativeFixture()
    try {
      const fetch = await state.fetch()
      await state.credentials("synthetic-native", 0)
      // When / Then
      await expect(fetch(url, nativeRequest)).rejects.toBeInstanceOf(OperationCancelledError)
      expect(state.transport.requests).toHaveLength(0)
    } finally {
      await state.dispose()
    }
  })
}

it("rejects a redirect without dispatching to its target", async () => {
  // Given
  const state = await nativeFixture()
  try {
    const fetch = await state.fetch()
    state.transport.enqueueResponse({
      status: 302,
      headers: { location: "https://foreign.test" },
      body: new Uint8Array(),
    })
    // When / Then
    await expect(fetch(nativeUrl, nativeRequest)).rejects.toBeInstanceOf(TypeError)
    expect(state.transport.requests.map((request) => new URL(request.url).origin)).toEqual([
      "https://api.anthropic.com",
    ])
  } finally {
    await state.dispose()
  }
})

it("retains native scope only for its owned refresh descendant", async () => {
  // Given
  const state = await nativeFixture()
  try {
    await state.credentials("synthetic-native", 100)
    const fetch = await state.fetch()
    state.clock.advanceBy(100)
    state.transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(
        '{"access_token":"managed-native","refresh_token":"managed-refresh","expires_at":1900000000000}',
      ),
    })
    state.transport.enqueueResponse({ status: 200, headers: {}, body: new Uint8Array() })
    // When
    await fetch(nativeUrl, nativeRequest)
    // Then
    expect(state.transport.requests).toHaveLength(2)
    expect(state.transport.requests.at(-1)?.headers["authorization"]).toBe("Bearer managed-native")
  } finally {
    await state.dispose()
  }
})
