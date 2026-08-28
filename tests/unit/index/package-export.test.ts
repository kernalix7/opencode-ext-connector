import { describe, expect, it } from "bun:test"
import { z } from "zod"

const PackageSchema = z.object({
  exports: z.record(z.string(), z.object({ types: z.string(), import: z.string() })),
})

describe("package exports", () => {
  it("publishes the Ollama SDK subpath", async () => {
    // Given
    const packageJson: unknown = await Bun.file("package.json").json()

    // When
    const manifest = PackageSchema.parse(packageJson)

    // Then
    expect(manifest.exports["./ollama"]).toEqual({
      types: "./dist/sdk/ollama.d.ts",
      import: "./dist/sdk/ollama.js",
    })
  })
})
