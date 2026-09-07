import { describe, expect, it } from "bun:test"

import { OperationCancelledError } from "../../../../src/core/errors"
import type { HttpResponse, HttpTransport } from "../../../../src/core/http"
import { createCommandCodeLanguageModel } from "../../../../src/providers/command-code/language-model"
import { FakeHttpTransport } from "../../../support/http"

const call = {
  prompt: [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }],
}

function errorResponse(status: number, code: string): HttpResponse {
  return {
    status,
    headers: {},
    body: new TextEncoder().encode(JSON.stringify({ error: { code, statusCode: status } })),
  }
}

function successResponse(): HttpResponse {
  return {
    status: 200,
    headers: {},
    body: new TextEncoder().encode(
      '{"type":"text-delta","text":"retried"}\n{"type":"finish","finishReason":"stop","totalUsage":{}}',
    ),
  }
}

function modelFixture(options: {
  readonly responses: readonly HttpResponse[]
  readonly tokens: readonly (string | null)[]
}): {
  readonly model: ReturnType<typeof createCommandCodeLanguageModel>
  readonly transport: FakeHttpTransport
  readonly credentialReads: () => number
  readonly versionReads: () => number
} {
  const transport = new FakeHttpTransport()
  for (const response of options.responses) transport.enqueueResponse(response)
  let credentialReads = 0
  let versionReads = 0
  const model = createCommandCodeLanguageModel({
    modelId: "default",
    transport,
    readAccessToken: async () => options.tokens[credentialReads++] ?? null,
    readCliVersion: async () => {
      versionReads += 1
      return "1.27.1"
    },
  })
  return {
    model,
    transport,
    credentialReads: () => credentialReads,
    versionReads: () => versionReads,
  }
}

describe("Command Code credential retry", () => {
  it("reloads a changed token and returns one successful logical generation", async () => {
    // Given
    const fixture = modelFixture({
      responses: [errorResponse(401, "EXPIRED"), successResponse()],
      tokens: ["failed-secret", "fresh-secret"],
    })

    // When
    const result = await fixture.model.doGenerate(call)

    // Then
    expect(result.content).toEqual([{ type: "text", text: "retried" }])
    expect(fixture.transport.requests.map((request) => request.headers["authorization"])).toEqual([
      "Bearer failed-secret",
      "Bearer fresh-secret",
    ])
    expect(fixture.credentialReads()).toBe(2)
    expect(fixture.versionReads()).toBe(1)
  })

  it.each([
    ["unchanged", "failed-secret"],
    ["missing", null],
  ])("keeps the original 401 terminal when the reloaded token is %s", async (_name, token) => {
    // Given
    const fixture = modelFixture({
      responses: [errorResponse(401, "FIRST_401")],
      tokens: ["failed-secret", token],
    })

    // When
    const generation = fixture.model.doGenerate(call)

    // Then
    await expect(generation).rejects.toMatchObject({
      name: "CommandCodeProviderError",
      statusCode: 401,
      providerCode: "FIRST_401",
    })
    expect(fixture.transport.requests).toHaveLength(1)
    expect(fixture.credentialReads()).toBe(2)
    await expect(generation).rejects.not.toHaveProperty(
      "message",
      expect.stringContaining("failed-secret"),
    )
  })

  it("uses the retry budget after a changed token and returns the second 401", async () => {
    // Given
    const fixture = modelFixture({
      responses: [errorResponse(401, "FIRST_401"), errorResponse(401, "SECOND_401")],
      tokens: ["failed-secret", "fresh-secret", "unused-secret"],
    })

    // When
    const generation = fixture.model.doGenerate(call)

    // Then
    await expect(generation).rejects.toMatchObject({ statusCode: 401, providerCode: "SECOND_401" })
    expect(fixture.transport.requests).toHaveLength(2)
    expect(fixture.credentialReads()).toBe(2)
  })

  it("does not reread credentials or retry an HTTP 403", async () => {
    // Given
    const fixture = modelFixture({
      responses: [errorResponse(403, "FORBIDDEN")],
      tokens: ["failed-secret", "unused-secret"],
    })

    // When
    const generation = fixture.model.doGenerate(call)

    // Then
    await expect(generation).rejects.toMatchObject({ statusCode: 403 })
    expect(fixture.transport.requests).toHaveLength(1)
    expect(fixture.credentialReads()).toBe(1)
  })

  it("does not reread credentials for an auth-like HTTP 200 NDJSON error", async () => {
    // Given
    const fixture = modelFixture({
      responses: [
        {
          status: 200,
          headers: {},
          body: new TextEncoder().encode(
            '{"type":"error","error":{"message":"expired","code":"AUTH","statusCode":401,"isRetryable":true}}',
          ),
        },
      ],
      tokens: ["failed-secret", "unused-secret"],
    })

    // When
    const generation = fixture.model.doGenerate(call)

    // Then
    await expect(generation).rejects.toMatchObject({ stage: "ndjson-stream", statusCode: 401 })
    expect(fixture.transport.requests).toHaveLength(1)
    expect(fixture.credentialReads()).toBe(1)
  })

  it("cancels after credential reread without opening a second request", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse(errorResponse(401, "EXPIRED"))
    const reload = Promise.withResolvers<string | null>()
    const reloadStarted = Promise.withResolvers<void>()
    const abort = new AbortController()
    let reads = 0
    const model = createCommandCodeLanguageModel({
      modelId: "default",
      transport,
      readAccessToken: async () => {
        reads += 1
        if (reads === 1) return "failed-secret"
        reloadStarted.resolve()
        return reload.promise
      },
      readCliVersion: async () => "1.27.1",
    })
    const generation = model.doGenerate({ ...call, abortSignal: abort.signal })
    await reloadStarted.promise

    // When
    abort.abort()
    reload.resolve("fresh-secret")

    // Then
    await expect(generation).rejects.toBeInstanceOf(OperationCancelledError)
    expect(transport.requests).toHaveLength(1)
  })

  it("bounds and closes the first 401 error body before credential reread", async () => {
    // Given
    let closed = false
    let requests = 0
    let reads = 0
    const transport: HttpTransport = {
      request: async () => {
        throw new TypeError("unexpected buffered request")
      },
      stream: async () => {
        requests += 1
        return {
          status: 401,
          headers: {},
          body: (async function* () {
            try {
              yield new Uint8Array(64 * 1024 + 1)
            } finally {
              closed = true
            }
          })(),
        }
      },
    }
    const model = createCommandCodeLanguageModel({
      modelId: "default",
      transport,
      readAccessToken: async () => {
        reads += 1
        return reads === 1 ? "failed-secret" : "fresh-secret"
      },
      readCliVersion: async () => "1.27.1",
    })

    // When
    const generation = model.doGenerate(call)

    // Then
    await expect(generation).rejects.toMatchObject({ reason: "response-body-too-large" })
    expect(closed).toBe(true)
    expect(requests).toBe(1)
    expect(reads).toBe(1)
  })
})
