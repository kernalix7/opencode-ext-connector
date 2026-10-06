import { expect, spyOn } from "bun:test"
import { randomUUID } from "node:crypto"
import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider"

import { getProductionOllamaBundle } from "../../../src/opencode/ollama-production"
import { createOllama } from "../../../src/sdk/ollama"
import { enqueueCloudCatalog, enqueueCloudReference } from "../providers/ollama/cloud-fixtures"
import { jsonResponse } from "../providers/ollama/http-fake"
import { LifecycleFetch } from "../providers/ollama/lifecycle-fetch"

export const reference = { hostedId: "one", referenceId: "one:cloud" } as const
const prompt: LanguageModelV3CallOptions["prompt"] = [
  { role: "user", content: [{ type: "text", text: "synthetic lifecycle fixture" }] },
]

export function assertNever(_value: never): never {
  throw new TypeError("Unexpected lifecycle fixture variant")
}

export function fixture() {
  const http = new LifecycleFetch()
  const base = `http://sdk-lifecycle.test/${randomUUID()}`
  const bundle = getProductionOllamaBundle(base)
  const replacement: typeof fetch = Object.assign(
    (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      http.fetch(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        init,
      ),
    { preconnect: () => undefined },
  )
  const intercept = spyOn(globalThis, "fetch").mockImplementation(replacement)
  const caller = new AbortController()
  const lease = bundle.catalog.acquire()
  const enqueue = (): void => {
    enqueueCloudCatalog(http.replies, [reference.hostedId])
    enqueueCloudReference(http.replies, reference)
  }
  const prepare = (): void => {
    http.replies.enqueue(bundle.endpoints.tagsURL, jsonResponse({ models: [] }))
    enqueueCloudReference(http.replies, reference)
    http.replies.enqueue(bundle.endpoints.pullURL, new Response('{"status":"success"}\n'))
    http.replies.enqueue(
      bundle.endpoints.chatURL,
      new Response('{"message":{"content":"ok"},"done":true}\n'),
    )
    http.block(bundle.endpoints.pullURL)
  }
  const cleanup = async (): Promise<void> => {
    caller.abort()
    http.release(bundle.endpoints.pullURL)
    await lease.dispose()
    intercept.mockRestore()
  }
  return {
    http,
    bundle,
    caller,
    lease,
    enqueue,
    prepare,
    cleanup,
    model: createOllama({ ollamaBaseURL: base }).languageModel(reference.referenceId),
  }
}

export async function invoke(
  model: LanguageModelV3,
  mode: "generate" | "stream",
  signal: AbortSignal,
): Promise<void> {
  switch (mode) {
    case "generate": {
      const result = await model.doGenerate({ prompt, abortSignal: signal })
      expect(
        result.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join(""),
      ).toBe("ok")
      return
    }
    case "stream": {
      const result = await model.doStream({ prompt, abortSignal: signal })
      const parts = await Array.fromAsync(result.stream)
      expect(
        parts
          .filter((part) => part.type === "text-delta")
          .map((part) => part.delta)
          .join(""),
      ).toBe("ok")
      expect(parts.some((part) => part.type === "error")).toBe(false)
      expect(parts.some((part) => part.type === "finish")).toBe(true)
      return
    }
    default:
      return assertNever(mode)
  }
}
