import { describe, expect, it, setSystemTime } from "bun:test"

import type { HttpResponse, HttpTransport } from "../../../../src/core/http"
import { createCommandCodeLanguageModel } from "../../../../src/providers/command-code/language-model"
import { FakeHttpTransport } from "../../../support/http"

const call = {
  prompt: [{ role: "user" as const, content: [{ type: "text" as const, text: "retry me" }] }],
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
    body: new TextEncoder().encode('{"type":"finish","finishReason":"stop"}'),
  }
}

describe("Command Code retry requests", () => {
  it("does not retry when a changed reader token leaves effective authorization unchanged", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse(errorResponse(401, "FIRST_401"))
    let reads = 0
    const model = createCommandCodeLanguageModel({
      modelId: "default",
      transport,
      readAccessToken: async () => (reads++ === 0 ? "old-reader-token" : "new-reader-token"),
      readCliVersion: async () => "1.27.1",
    })

    // When
    const generation = model.doGenerate({
      ...call,
      headers: { Authorization: "Bearer fixed-call-authorization" },
    })

    // Then
    await expect(generation).rejects.toMatchObject({ statusCode: 401, providerCode: "FIRST_401" })
    expect(transport.requests).toHaveLength(1)
    expect(transport.requests.at(0)?.headers["authorization"]).toBe(
      "Bearer fixed-call-authorization",
    )
    expect(reads).toBe(2)
  })

  it("retries once with a rebuilt request while preserving request identity and overrides", async () => {
    // Given
    const firstSessionId = "123e4567-e89b-42d3-a456-426614174000"
    const secondSessionId = "123e4567-e89b-42d3-a456-426614174001"
    const originalWorkingDir = process.cwd()
    const changedWorkingDir = "/tmp"
    const originalDate = new Date("2030-01-02T03:04:05.000Z")
    const changedDate = new Date("2031-03-04T05:06:07.000Z")
    const transport = new FakeHttpTransport()
    transport.enqueueResponse(errorResponse(401, "FIRST_401"))
    transport.enqueueResponse(successResponse())
    let reads = 0
    let sessionIdGenerations = 0
    const model = createCommandCodeLanguageModel({
      modelId: "default",
      transport,
      readAccessToken: async () => {
        reads += 1
        if (reads === 2) {
          process.chdir(changedWorkingDir)
          setSystemTime(changedDate)
        }
        return reads === 1 ? "expired-token" : "fresh-token"
      },
      readCliVersion: async () => "1.27.1",
      generateSessionId: () => {
        const generated = [firstSessionId, secondSessionId].at(sessionIdGenerations)
        sessionIdGenerations += 1
        if (generated === undefined) throw new TypeError("unexpected session ID generation")
        return generated
      },
      headers: { "X-Custom": "model-value" },
    })

    // When
    setSystemTime(originalDate)
    try {
      await model.doGenerate({ ...call, headers: { "x-CUSTOM": "call-value" } })
    } finally {
      process.chdir(originalWorkingDir)
      setSystemTime()
    }

    // Then
    const first = transport.requests.at(0)
    const second = transport.requests.at(1)
    expect(transport.requests).toHaveLength(2)
    expect(first?.headers["authorization"]).toBe("Bearer expired-token")
    expect(second?.headers["authorization"]).toBe("Bearer fresh-token")
    expect(first?.body).toEqual(second?.body)
    expect(sessionIdGenerations).toBe(1)
    expect(first?.headers["x-session-id"]).toBe(firstSessionId)
    expect(second?.headers["x-session-id"]).toBe(firstSessionId)
    expect(first?.headers["x-custom"]).toBe("call-value")
    expect(second?.headers["x-custom"]).toBe("call-value")
    expect(first?.headers["traceparent"]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
    expect(second?.headers["traceparent"]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
    expect(first?.headers["traceparent"]).not.toBe(second?.headers["traceparent"])
    const firstBody = first?.body === null ? undefined : first?.body
    const secondBody = second?.body === null ? undefined : second?.body
    expect(firstBody).toBeDefined()
    expect(secondBody).toBeDefined()
    if (firstBody === undefined || secondBody === undefined) {
      throw new TypeError("retry request body missing")
    }
    const decoder = new TextDecoder()
    const firstPayload = JSON.parse(decoder.decode(firstBody))
    const secondPayload = JSON.parse(decoder.decode(secondBody))
    expect(firstPayload.config.workingDir).toBe(originalWorkingDir)
    expect(secondPayload.config.workingDir).toBe(originalWorkingDir)
    expect(firstPayload.config.date).toBe("2030-01-02")
    expect(secondPayload.config.date).toBe("2030-01-02")
    expect(firstPayload.threadId).toBe(firstSessionId)
    expect(secondPayload.threadId).toBe(firstSessionId)
    expect(decoder.decode(firstBody)).not.toContain(secondSessionId)
    expect(decoder.decode(secondBody)).not.toContain(secondSessionId)
  })

  it("finishes draining a finite first 401 body before rereading credentials", async () => {
    // Given
    const bodyEvents: string[] = []
    let requests = 0
    let reads = 0
    const transport: HttpTransport = {
      request: async () => {
        throw new TypeError("unexpected buffered request")
      },
      stream: async () => {
        requests += 1
        if (requests === 2) {
          return {
            status: 200,
            headers: {},
            body: (async function* () {
              yield successResponse().body
            })(),
          }
        }
        return {
          status: 401,
          headers: {},
          body: (async function* () {
            try {
              yield new TextEncoder().encode('{"error":{"code":')
              bodyEvents.push("first-consumed")
              yield new TextEncoder().encode('"FIRST_401","statusCode":401}}')
              bodyEvents.push("second-consumed")
            } finally {
              bodyEvents.push("closed")
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
        if (reads === 2) {
          expect(bodyEvents).toEqual(["first-consumed", "second-consumed", "closed"])
        }
        return reads === 1 ? "expired-token" : "fresh-token"
      },
      readCliVersion: async () => "1.27.1",
    })

    // When
    await model.doGenerate(call)

    // Then
    expect(bodyEvents).toEqual(["first-consumed", "second-consumed", "closed"])
    expect(requests).toBe(2)
    expect(reads).toBe(2)
  })
})
