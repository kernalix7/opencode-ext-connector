import { describe, expect, it } from "bun:test"
import { EventEmitter } from "node:events"

import { bindProcessExit } from "../../../src/opencode/process-exit"

describe("bindProcessExit", () => {
  it("disposes once on beforeExit", async () => {
    // Given
    const proc = new EventEmitter()
    let calls = 0
    const stop = bindProcessExit(async () => {
      calls += 1
    }, proc)
    // When
    proc.emit("beforeExit")
    proc.emit("beforeExit")
    stop()
    // Then
    expect(calls).toBe(1)
  })
})
