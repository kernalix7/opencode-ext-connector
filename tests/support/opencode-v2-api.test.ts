import { describe, expect, it } from "bun:test"

import {
  generateTextSchema,
  integrationListSchema,
  listPlugins,
  OpenCodeV2PluginFailedError,
  pluginListSchema,
  providerListSchema,
  readUntil,
} from "./opencode-v2-api"

const directory = "/tmp/opencode-v2-fixture"

describe("OpenCode V2 API schemas", () => {
  it("fails immediately with the loader diagnostic when a plugin fails", async () => {
    // Given
    let requests = 0
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        requests += 1
        return Response.json({
          location: { directory },
          data: [
            {
              source: { type: "local", path: "/tmp/fixture" },
              state: { status: "failed", error: "fixture loader failure" },
              features: {},
            },
          ],
        })
      },
    })
    try {
      // When
      const result = readUntil({
        label: "fixture plugin",
        read: () => listPlugins({ directory, password: "fixture-password", url: server.url.href }),
        ready: (plugins) => plugins.some((plugin) => plugin.status === "active"),
        timeoutMs: 15_000,
      })

      // Then
      await expect(result).rejects.toBeInstanceOf(OpenCodeV2PluginFailedError)
      await expect(result).rejects.toMatchObject({
        plugin: {
          error: "fixture loader failure",
          source: { type: "local", path: "/tmp/fixture" },
        },
      })
      expect(requests).toBe(1)
    } finally {
      await server.stop(true)
    }
  })

  it("parses an active local plugin from the runtime list envelope", () => {
    // Given
    const body = {
      location: { directory },
      data: [
        {
          id: "fixture-direct",
          source: { type: "local", path: "/tmp/fixture.mjs" },
          state: { status: "active" },
          features: { server: true },
        },
      ],
    }

    // When
    const parsed = pluginListSchema.parse(body)

    // Then
    expect(parsed.data[0]?.id).toBe("fixture-direct")
    expect(parsed.data[0]?.status).toBe("active")
  })

  it("parses a provider list without treating builtin ids as connector ids", () => {
    // Given
    const body = {
      location: { directory },
      data: [
        {
          id: "opencode",
          integrationID: "opencode",
          name: "OpenCode Zen",
          activation: "enabled",
          package: "aisdk:@ai-sdk/openai-compatible",
        },
      ],
    }

    // When
    const parsed = providerListSchema.parse(body)

    // Then
    expect(parsed.data.map((provider) => provider.id)).toEqual(["opencode"])
  })

  it("parses a key credential connection without reading the stored secret", () => {
    // Given
    const body = {
      location: { directory },
      data: [
        {
          id: "ollama",
          name: "Ollama",
          connections: [{ type: "credential", id: "cred", label: "cli", method: "key" }],
        },
      ],
    }

    // When
    const parsed = integrationListSchema.parse(body)

    // Then
    expect(parsed.data[0]?.connections[0]).toEqual({
      type: "credential",
      id: "cred",
      label: "cli",
      method: "key",
    })
  })

  it("parses stateless generate text from the experimental response", () => {
    // Given
    const body = { data: { text: "fixture-token" } }

    // When
    const parsed = generateTextSchema.parse(body)

    // Then
    expect(parsed.data.text).toBe("fixture-token")
  })
})
