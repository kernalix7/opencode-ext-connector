import { describe, expect, it } from "bun:test"

import { createOllamaSessionAuth } from "../../../src/opencode/v1-session-auth"
import { FakeFetch, jsonResponse } from "../providers/ollama/http-fake"

const LOCAL_URL = "http://localhost:11434/api/tags"

describe("Ollama session auth", () => {
  it("tells the user to start the daemon without claiming a missing login", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(LOCAL_URL, jsonResponse({}, 503))
    const method = createOllamaSessionAuth(http.fetch).methods[0]
    if (method?.authorize === undefined) throw new Error("Ollama authorization method is missing")

    // When
    const authorization = await method.authorize({})
    if (!("instructions" in authorization)) throw new Error("Ollama instructions are missing")

    // Then
    expect(authorization.instructions).toContain("Start the local Ollama daemon")
    expect(authorization.instructions).not.toContain("logged-in")
    expect(authorization.instructions).not.toContain("vendor CLI")
  })

  it("explains daemon reuse and leaves cloud sign-in to Ollama", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(LOCAL_URL, jsonResponse({ models: [] }))
    const method = createOllamaSessionAuth(http.fetch).methods[0]
    if (method?.authorize === undefined) throw new Error("Ollama authorization method is missing")

    // When
    const authorization = await method.authorize({})
    if (!("instructions" in authorization)) throw new Error("Ollama instructions are missing")

    // Then
    expect(authorization.instructions).toContain("reuse the running local Ollama daemon")
    expect(authorization.instructions).toContain("ollama signin")
    expect(authorization.instructions).toContain("plugin does not run sign-in")
  })

  it("withholds the marker when the daemon disappears before callback", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(LOCAL_URL, jsonResponse({ models: [] }))
    http.enqueue(LOCAL_URL, jsonResponse({}, 503))
    const method = createOllamaSessionAuth(http.fetch).methods[0]
    if (method?.authorize === undefined) throw new Error("Ollama authorization method is missing")
    const authorization = await method.authorize({})
    if (!("callback" in authorization)) throw new Error("Ollama callback is missing")

    // When
    const callback = await authorization.callback("")

    // Then
    expect(callback).toEqual({ type: "failed" })
    expect(http.requests).toHaveLength(2)
  })

  it("re-probes and returns the marker when callback follows an initial failure", async () => {
    // Given
    const http = new FakeFetch()
    http.enqueue(LOCAL_URL, jsonResponse({}, 503))
    http.enqueue(LOCAL_URL, jsonResponse({ models: [] }))
    const method = createOllamaSessionAuth(http.fetch).methods[0]
    if (method?.authorize === undefined) throw new Error("Ollama authorization method is missing")
    const authorization = await method.authorize({})
    if (!("callback" in authorization)) throw new Error("Ollama callback is missing")

    // When
    const callback = await authorization.callback("")

    // Then
    expect(callback).toEqual({ type: "success", provider: "ollama", key: "cli-session:ollama" })
    expect(http.requests).toHaveLength(2)
  })
})
