import { describe, expect, it } from "bun:test"

import {
  createCommandCodeVersionResolver,
  parseCommandCodeCliVersion,
} from "../../../../src/providers/command-code/cli-version"
import { FakeHttpTransport } from "../../../support/http"

const signal = new AbortController().signal

describe("createCommandCodeVersionResolver", () => {
  it("parses installed command-code version output", () => {
    // Given / When / Then
    expect(parseCommandCodeCliVersion("1.27.1\n")).toBe("1.27.1")
  })

  it("returns null when stdout has no version", () => {
    // Given / When / Then
    expect(parseCommandCodeCliVersion("not a version")).toBeNull()
  })

  it("prefers COMMAND_CODE_CLI_VERSION without spawning or fetching", async () => {
    // Given
    const transport = new FakeHttpTransport()
    let spawned = 0
    const resolve = createCommandCodeVersionResolver({
      env: { COMMAND_CODE_CLI_VERSION: "v1.30.0" },
      transport,
      readInstalledVersion: () => {
        spawned += 1
        return "1.0.0"
      },
    })

    // When / Then
    expect(await resolve(signal)).toBe("1.30.0")
    expect(spawned).toBe(0)
    expect(transport.requests).toHaveLength(0)
  })

  it("uses an installed binary before the registry", async () => {
    // Given
    const transport = new FakeHttpTransport()
    const resolve = createCommandCodeVersionResolver({
      env: {},
      transport,
      readInstalledVersion: () => "1.27.1",
    })

    // When / Then
    expect(await resolve(signal)).toBe("1.27.1")
    expect(transport.requests).toHaveLength(0)
  })

  it("falls back to the latest published command-code package without a binary", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(JSON.stringify({ version: "1.49.1" })),
    })
    const resolve = createCommandCodeVersionResolver({
      env: {},
      transport,
      readInstalledVersion: () => null,
    })

    // When / Then
    expect(await resolve(signal)).toBe("1.49.1")
    expect(transport.requests[0]?.url).toBe("https://registry.npmjs.org/command-code/latest")
  })

  it("returns null when every source is unavailable", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueError(new Error("offline"))
    const resolve = createCommandCodeVersionResolver({
      env: { PATH: "" },
      transport,
    })

    // When / Then
    expect(await resolve(signal)).toBeNull()
  })
})
