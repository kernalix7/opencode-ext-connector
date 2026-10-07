import { expect, it } from "bun:test"
import type { HttpTransport } from "../../../../src/core/http"
import { createCommandCodeLanguageModel } from "../../../../src/providers/command-code/subscription-language-model"
import { FakeHttpTransport } from "../../../support/http"

const call = {
  prompt: [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }],
}
const version = async (): Promise<string> => "1.2.3"

it("disposes the deadline and parent listener when credential loading fails", async () => {
  // Given
  const parent = new AbortController()
  let scoped: AbortSignal | undefined
  const failure = new TypeError("synthetic reader failure")
  const model = createCommandCodeLanguageModel({
    modelId: "catalog/model",
    transport: new FakeHttpTransport(),
    readAccessToken: async (signal) => {
      scoped = signal
      throw failure
    },
    readCliVersion: version,
  })
  // When / Then
  await expect(model.doGenerate({ ...call, abortSignal: parent.signal })).rejects.toBe(failure)
  parent.abort()
  expect(scoped?.aborted).toBe(false)
})

it("does not send a generation request after cancellation during version lookup", async () => {
  // Given
  const parent = new AbortController()
  const transport = new FakeHttpTransport()
  const versionStarted = Promise.withResolvers<void>()
  const release = Promise.withResolvers<string>()
  const model = createCommandCodeLanguageModel({
    modelId: "catalog/model",
    transport,
    readAccessToken: async () => "synthetic",
    readCliVersion: async () => {
      versionStarted.resolve()
      return release.promise
    },
  })
  const generation = model.doGenerate({ ...call, abortSignal: parent.signal })
  await versionStarted.promise
  // When
  parent.abort()
  release.resolve("1.2.3")
  // Then
  await expect(generation).rejects.toMatchObject({ name: "OperationCancelledError" })
  expect(transport.requests).toHaveLength(0)
})

it("releases an upstream streaming iterator when a consumer closes the stream", async () => {
  // Given
  const gate = Promise.withResolvers<void>()
  const completed = Promise.withResolvers<void>()
  let closed = false
  const transport: HttpTransport = {
    request: async () => {
      throw new TypeError("unexpected buffered request")
    },
    stream: async (_request, signal) => ({
      status: 200,
      headers: {},
      body: (async function* () {
        try {
          yield new TextEncoder().encode('{"type":"text-delta","text":"first"}\n')
          await Promise.race([
            gate.promise,
            new Promise<void>((resolve) =>
              signal.addEventListener("abort", () => resolve(), { once: true }),
            ),
          ])
        } finally {
          closed = true
          completed.resolve()
        }
      })(),
    }),
  }
  const model = createCommandCodeLanguageModel({
    modelId: "catalog/model",
    transport,
    readAccessToken: async () => "synthetic",
    readCliVersion: version,
  })
  const { stream } = await model.doStream(call)
  const reader = stream.getReader()
  await reader.read()
  // When
  await reader.cancel()
  gate.resolve()
  await completed.promise
  // Then
  expect(closed).toBe(true)
})
