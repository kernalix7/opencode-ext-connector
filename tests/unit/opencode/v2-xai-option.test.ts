import { describe, expect, it } from "bun:test"

import { ZodError } from "zod"
import { setupV2Connector } from "../../../src/opencode/v2-setup"
import { createV2Host } from "./v2-host"

describe("V2 unsupported xAI options", () => {
  for (const mode of ["authority", "consumer"] as const) {
    it(`rejects ${mode} before allocating runtime resources`, async () => {
      // Given
      const host = createV2Host({ pluginOptions: { providers: [], xaiOAuth: { mode } } })
      let allocated = false

      // When
      const setup = setupV2Connector(host, {
        createTransport: () => {
          allocated = true
          throw new Error("unexpected resource allocation")
        },
      })

      // Then
      await expect(setup).rejects.toBeInstanceOf(ZodError)
      expect(allocated).toBe(false)
    })
  }
})
