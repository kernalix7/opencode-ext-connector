import { describe, expect, it } from "bun:test"
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"

import { AdapterError } from "../../../src/core/errors"
import { CONNECTOR_AISDK_PACKAGE } from "../../../src/opencode/v2-catalog"
import {
  registerV2LanguageHooks,
  type V2ModelHook,
  type V2ModelHookInput,
} from "../../../src/opencode/v2-language"
import { FakeClock } from "../../support/clock"
import { FakeHttpTransport } from "../../support/http"

const call: LanguageModelV3CallOptions = {
  prompt: [{ role: "user", content: [{ type: "text", text: "fixture" }] }],
}

describe("V2 post-await dispatch membership", () => {
  it.each(["generate", "stream"])(
    "does not dispatch %s when membership changes during final validation",
    async (operation) => {
      // Given
      const transport = new FakeHttpTransport()
      const started = Promise.withResolvers<void>()
      const connected = Promise.withResolvers<boolean>()
      let membership = true
      let checks = 0
      let languageHook: ((input: V2ModelHookInput) => void) | undefined
      const hook: V2ModelHook = async (name, callback) => {
        if (name === "language") languageHook = callback
        return { dispose: async () => undefined }
      }
      await registerV2LanguageHooks(hook, {
        deps: {
          env: {},
          clock: new FakeClock(),
          transport,
          authStore: { matchAuth: async () => ({ kind: "api-key", key: "fixture-key" }) },
        },
        hasModel: () => membership,
        generation: () => 1,
        lifetime: new AbortController().signal,
        providerIds: ["claude"],
        isConnected: async () => {
          checks += 1
          if (checks === 4) {
            started.resolve()
            return connected.promise
          }
          return true
        },
      })
      const input: V2ModelHookInput = {
        model: { providerID: "claude", modelID: "fixture-model", package: CONNECTOR_AISDK_PACKAGE },
      }
      languageHook?.(input)
      const model = input.language
      if (model === undefined) throw new Error("Missing fixture language")
      const pending = operation === "generate" ? model.doGenerate(call) : model.doStream(call)
      await started.promise
      // When
      membership = false
      connected.resolve(true)
      // Then
      await expect(pending).rejects.toBeInstanceOf(AdapterError)
      expect(transport.requests).toHaveLength(0)
    },
  )
})
