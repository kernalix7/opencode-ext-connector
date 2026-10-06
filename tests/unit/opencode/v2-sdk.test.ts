import { describe, expect, it } from "bun:test"

import { NoSuchModelError } from "@ai-sdk/provider"
import { z } from "zod"

import * as bootstrap from "../../../src/opencode/v2-sdk"
import { packV2Plugin } from "../../support/opencode-v2-packed"

describe("V2 SDK bootstrap", () => {
  it.each(["languageModel", "embeddingModel", "imageModel"] as const)(
    "fails closed for %s when scoped V2 hooks are absent",
    (modelType) => {
      // Given
      const sdk = bootstrap.createConnectorProvider()

      // When / Then
      expect(sdk.specificationVersion).toBe("v3")
      expect(() => sdk[modelType]("unbound-model")).toThrow(NoSuchModelError)
    },
  )

  it("resolves the factory from the encoded locator inside the unmodified packed package", async () => {
    // Given
    const packed = await packV2Plugin()
    try {
      const entry = new URL(`${packed.packageUrl}/`)
      const catalog: unknown = await import(new URL("../opencode/v2-catalog.js", entry).href)
      const { CONNECTOR_AISDK_PACKAGE } = z
        .object({ CONNECTOR_AISDK_PACKAGE: z.string().startsWith("aisdk:") })
        .parse(catalog)
      const locator = CONNECTOR_AISDK_PACKAGE.slice("aisdk:".length)

      // When
      const module: unknown = await import(locator)
      const factory = z.object({ createConnectorProvider: z.function() }).parse(module)

      // Then
      expect(locator).toBe(new URL("../opencode/v2-sdk.js", entry).href)
      expect(typeof factory.createConnectorProvider).toBe("function")
      expect(Object.keys(bootstrap).filter((key) => key.startsWith("create"))).toEqual([
        "createConnectorProvider",
      ])
    } finally {
      await packed.cleanup()
    }
  }, 60_000)
})
