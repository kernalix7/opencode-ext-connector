import { expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createCommandCodeAdapter } from "../../../../src/providers/command-code/adapter"
import { readCommandCodeCredentialSource } from "../../../../src/providers/command-code/auth"
import { listCommandCodeModels } from "../../../../src/providers/command-code/models"
import { createCommandCodeLanguageModel } from "../../../../src/providers/command-code/subscription-language-model"
import { FakeHttpTransport } from "../../../support/http"

const signal = new AbortController().signal
const prompt = {
  prompt: [{ role: "user" as const, content: [{ type: "text" as const, text: "hello" }] }],
}
const encoded = (text: string): Uint8Array => new TextEncoder().encode(text)

it("selects an existing file credential and observes only its source location", async () => {
  // Given
  const homeDir = await mkdtemp(join(tmpdir(), "command-subscription-"))
  try {
    await mkdir(join(homeDir, ".commandcode"))
    await writeFile(join(homeDir, ".commandcode", "auth.json"), '{"apiKey":"synthetic"}')
    // When
    const source = await readCommandCodeCredentialSource({ HOME: homeDir }, signal)
    // Then
    expect(source).toEqual({
      accessToken: "synthetic",
      sourceIdentity: join(homeDir, ".commandcode", "auth.json"),
    })
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

it("observes the selected environment name rather than exposing token identity", async () => {
  // Given
  const env = { COMMANDCODE_API_KEY: "synthetic-alias", CC_API_KEY: "other-alias" }
  // When
  const source = await readCommandCodeCredentialSource(env, signal)
  // Then
  expect(source).toEqual({ accessToken: "synthetic-alias", sourceIdentity: "COMMANDCODE_API_KEY" })
})

it("uses the bearer catalog without selecting official API endpoints", async () => {
  // Given
  const transport = new FakeHttpTransport()
  transport.enqueueResponse({
    status: 200,
    headers: {},
    body: encoded('{"data":[{"id":"catalog/model"}]}'),
  })
  const adapter = createCommandCodeAdapter({
    readAccessToken: async () => "synthetic",
    listModels: (token, scoped) => listCommandCodeModels(transport, token, scoped),
  })
  // When
  const snapshot = await adapter.snapshot(signal)
  // Then
  expect(snapshot.status).toBe("ready")
  expect(transport.requests[0]?.url).toBe("https://api.commandcode.ai/provider/v1/models")
  expect(transport.requests[0]?.headers["authorization"]).toBe("Bearer synthetic")
})

it("generates text, reasoning, tools and usage from /alpha/generate NDJSON with scoped authorization", async () => {
  // Given
  const transport = new FakeHttpTransport()
  transport.enqueueResponse({
    status: 200,
    headers: {},
    body: encoded(
      [
        '{"type":"reasoning-delta","text":"think"}',
        '{"type":"text-delta","text":"answer"}',
        '{"type":"tool-call","toolCallId":"t1","toolName":"Read","input":{"path":"a"}}',
        '{"type":"finish","finishReason":"tool_calls","totalUsage":{"inputTokens":4,"outputTokens":5}}',
      ].join("\n"),
    ),
  })
  const model = createCommandCodeLanguageModel({
    modelId: "catalog/model",
    transport,
    readAccessToken: async () => "synthetic",
    readCliVersion: async () => "1.2.3",
    headers: { Authorization: "Bearer injected", "X-API-Key": "injected", "X-Extra": "model" },
  })
  // When
  const result = await model.doGenerate({
    ...prompt,
    headers: { AUTHORIZATION: "Bearer attacker", "x-api-key": "attacker", "X-Extra": "call" },
  })
  // Then
  expect(transport.requests[0]?.url).toBe("https://api.commandcode.ai/alpha/generate")
  expect(transport.requests[0]?.headers["authorization"]).toBe("Bearer synthetic")
  expect(transport.requests[0]?.headers["x-api-key"]).toBeUndefined()
  expect(transport.requests[0]?.headers["x-extra"]).toBe("call")
  expect(result.content).toEqual([
    { type: "reasoning", text: "think" },
    { type: "text", text: "answer" },
    { type: "tool-call", toolCallId: "t1", toolName: "Read", input: '{"path":"a"}' },
  ])
  expect(result.usage.inputTokens.total).toBe(4)
})

it("retries only the exact pre-output 401 with an approved changed callback token", async () => {
  // Given
  const transport = new FakeHttpTransport()
  transport.enqueueResponse({
    status: 401,
    headers: {},
    body: encoded('{"error":{"code":"EXPIRED"}}'),
  })
  transport.enqueueResponse({
    status: 200,
    headers: {},
    body: encoded('{"type":"text-delta","text":"fresh"}\n{"type":"finish"}'),
  })
  let reads = 0
  const model = createCommandCodeLanguageModel({
    modelId: "catalog/model",
    transport,
    readAccessToken: async () => (++reads === 1 ? "old" : "new"),
    readCliVersion: async () => "1.2.3",
  })
  // When
  const result = await model.doGenerate(prompt)
  // Then
  expect(result.content).toEqual([{ type: "text", text: "fresh" }])
  expect(transport.requests.map((request) => request.headers["authorization"])).toEqual([
    "Bearer old",
    "Bearer new",
  ])
})

it("uses an isolated file-only credential for actual generation without invoking a CLI", async () => {
  // Given
  const homeDir = await mkdtemp(join(tmpdir(), "command-file-generation-"))
  try {
    await mkdir(join(homeDir, ".commandcode"))
    await writeFile(join(homeDir, ".commandcode", "auth.json"), '{"accessToken":"file-only"}')
    const env = {
      HOME: homeDir,
      XDG_CONFIG_HOME: join(homeDir, "xdg"),
      PATH: "",
      COMMAND_CODE_CLI_VERSION: "v2.3.4",
    }
    const transport = new FakeHttpTransport()
    transport.enqueueResponse({
      status: 200,
      headers: {},
      body: encoded('{"type":"text-delta","text":"file result"}\n{"type":"finish"}'),
    })
    const model = createCommandCodeLanguageModel({
      modelId: "catalog/model",
      transport,
      env,
      readAccessToken: async (scoped) =>
        (await readCommandCodeCredentialSource(env, scoped))?.accessToken ?? null,
    })
    // When
    const result = await model.doGenerate(prompt)
    // Then
    expect(result.content).toEqual([{ type: "text", text: "file result" }])
    expect(transport.requests).toHaveLength(1)
    expect(transport.requests[0]?.headers["authorization"]).toBe("Bearer file-only")
    expect(transport.requests[0]?.headers["x-command-code-version"]).toBe("2.3.4")
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

it("does not replay a successful HTTP response containing an auth-like NDJSON error", async () => {
  // Given
  const transport = new FakeHttpTransport()
  transport.enqueueResponse({
    status: 200,
    headers: {},
    body: encoded(
      '{"type":"text-delta","text":"already emitted"}\n{"type":"error","error":{"message":"expired","statusCode":401}}',
    ),
  })
  let reads = 0
  const model = createCommandCodeLanguageModel({
    modelId: "catalog/model",
    transport,
    readAccessToken: async () => (++reads === 1 ? "old" : "new"),
    readCliVersion: async () => "1.2.3",
  })
  // When / Then
  await expect(model.doGenerate(prompt)).rejects.toMatchObject({
    stage: "ndjson-stream",
    statusCode: 401,
  })
  expect(reads).toBe(1)
  expect(transport.requests).toHaveLength(1)
})

it("does not retry unchanged credentials after a 401", async () => {
  // Given
  const transport = new FakeHttpTransport()
  transport.enqueueResponse({
    status: 401,
    headers: {},
    body: encoded('{"error":{"code":"EXPIRED"}}'),
  })
  let reads = 0
  const model = createCommandCodeLanguageModel({
    modelId: "catalog/model",
    transport,
    readAccessToken: async () => {
      reads += 1
      return "same"
    },
    readCliVersion: async () => "1.2.3",
  })
  // When / Then
  await expect(model.doGenerate(prompt)).rejects.toMatchObject({
    statusCode: 401,
    providerCode: "EXPIRED",
  })
  expect(reads).toBe(2)
  expect(transport.requests).toHaveLength(1)
})

it("rejects malformed session IDs before making a request", () => {
  // Given / When / Then
  expect(() =>
    createCommandCodeLanguageModel({
      modelId: "catalog/model",
      transport: new FakeHttpTransport(),
      readAccessToken: async () => "synthetic",
      generateSessionId: () => "not-a-uuid",
    }),
  ).toThrow()
})
