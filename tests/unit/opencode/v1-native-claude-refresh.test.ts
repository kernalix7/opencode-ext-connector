import { expect, it } from "bun:test"

import { OperationCancelledError } from "../../../src/core/errors"
import { nativeFixture, nativeRequest, nativeUrl } from "./native-claude-fixture"

it.each([0, 1_900_000_000_000])(
  "refuses a mismatched native OAuth callback before renewal when vendor expiry is %s",
  async (expiry) => {
    // Given
    const state = await nativeFixture()
    try {
      await state.credentials("synthetic-native", expiry)
      await state.gate({
        type: "oauth",
        access: "stored-oauth",
        refresh: "stored-refresh",
        expires: 1000,
      })
      state.select({
        type: "oauth",
        access: "foreign-oauth",
        refresh: "foreign-refresh",
        expires: 1000,
      })
      // When
      const result = await state.load()
      // Then
      expect(result).toEqual({})
      expect(state.transport.requests).toHaveLength(0)
    } finally {
      await state.dispose()
    }
  },
)

it("rechecks the vendor source after a native 401 without replay under a foreign token", async () => {
  // Given
  const state = await nativeFixture()
  try {
    const fetch = await state.fetch()
    const originalStream = state.transport.stream.bind(state.transport)
    state.transport.stream = async (request, signal) => {
      const response = await originalStream(request, signal)
      await state.credentials("foreign-native")
      return response
    }
    state.transport.enqueueResponse({ status: 401, headers: {}, body: new Uint8Array() })
    // When / Then
    await expect(fetch(nativeUrl, nativeRequest)).rejects.toBeInstanceOf(OperationCancelledError)
    expect(state.transport.requests).toHaveLength(1)
    expect(state.transport.requests[0]?.headers["authorization"]).toBe("Bearer synthetic-native")
  } finally {
    await state.dispose()
  }
})
