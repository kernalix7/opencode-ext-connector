import { describe, expect, it } from "bun:test"

import { parseOllamaEndpoints } from "../../../../src/providers/ollama/endpoints"

describe("parseOllamaEndpoints", () => {
  it("uses frozen localhost endpoints when the base URL is omitted", () => {
    // Given / When
    const endpoints = parseOllamaEndpoints(undefined)

    // Then
    expect(endpoints).toEqual({
      baseURL: "http://localhost:11434",
      tagsURL: "http://localhost:11434/api/tags",
      pullURL: "http://localhost:11434/api/pull",
      chatURL: "http://localhost:11434/api/chat",
    })
    expect(Object.isFrozen(endpoints)).toBe(true)
  })

  it("normalizes a remote base while preserving its path prefix", () => {
    // Given / When
    const endpoints = parseOllamaEndpoints("HTTPS://Daemon.Example.test:443/ollama/")

    // Then
    expect(endpoints).toEqual({
      baseURL: "https://daemon.example.test/ollama",
      tagsURL: "https://daemon.example.test/ollama/api/tags",
      pullURL: "https://daemon.example.test/ollama/api/pull",
      chatURL: "https://daemon.example.test/ollama/api/chat",
    })
  })

  it.each([
    null,
    "http://dae\nmon.example.test",
    "http://dae\tmon.example.test",
    "http://daemon.example.test/pre\tfix",
    "http://daemon.example.test\\prefix",
    "http://@daemon.example.test",
  ])("rejects ambiguous Ollama daemon base %s", (baseURL) => {
    // Given / When / Then
    expect(() => parseOllamaEndpoints(baseURL)).toThrow()
  })

  it.each([
    "",
    " ",
    " http://daemon.example.test",
    "http://daemon.example.test ",
    "/ollama",
    "//daemon.example.test",
    "http:daemon.example.test",
    "ftp://daemon.example.test",
    "http://",
    "http://user@daemon.example.test",
    "http://daemon.example.test?mode=remote",
    "http://daemon.example.test#remote",
    "http://daemon.example.test?",
    "http://daemon.example.test#",
    "http://daemon.example.test/api/tags",
    "http://daemon.example.test/api/tags/",
    "http://daemon.example.test/prefix/api/tags",
    "http://daemon.example.test/api/pull",
    "http://daemon.example.test/api/chat",
    "https://ollama.com",
    "https://api.ollama.com",
    "https://OLLAMA.COM",
    "https://ollama.com.",
  ])("rejects unsafe or malformed daemon base %s", (baseURL) => {
    // Given / When / Then
    expect(() => parseOllamaEndpoints(baseURL)).toThrow()
  })

  it("accepts a hostname that only looks like an Ollama Cloud subdomain", () => {
    // Given / When
    const endpoints = parseOllamaEndpoints("https://ollama.com.example.test/prefix")

    // Then
    expect(endpoints.baseURL).toBe("https://ollama.com.example.test/prefix")
  })
})
