import { describe, expect, it } from "bun:test"

import { createAsyncDisposable } from "../../../src/core/lifecycle"

describe("createAsyncDisposable", () => {
  it("runs cleanup once across both disposal entries", async () => {
    // Given
    let calls = 0
    const handle = createAsyncDisposable(() => {
      calls += 1
    })
    // When
    await Promise.all([handle.dispose(), handle[Symbol.asyncDispose](), handle.dispose()])
    // Then
    expect(calls).toBe(1)
  })

  it("returns the same cached promise", () => {
    // Given
    const handle = createAsyncDisposable(() => undefined)
    // When
    const first = handle.dispose()
    const second = handle.dispose()
    // Then
    expect(first).toBe(second)
  })

  it("caches cleanup rejection", async () => {
    // Given
    const failure = new TypeError("cleanup")
    const handle = createAsyncDisposable(() => {
      throw failure
    })
    // When
    const first = handle.dispose()
    const second = handle.dispose()
    // Then
    expect(first).toBe(second)
    await expect(first).rejects.toBe(failure)
  })
})
