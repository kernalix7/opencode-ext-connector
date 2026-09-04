import { describe, expect, it } from "bun:test"
import { z } from "zod"

const PackageSchema = z.object({
  version: z.string(),
  main: z.string(),
  types: z.string(),
  exports: z.record(z.string(), z.object({ types: z.string(), import: z.string() })),
  scripts: z.record(z.string(), z.string()),
})

describe("package exports", () => {
  it("publishes the exact 0.2.0 package entry points", async () => {
    // Given
    const packageJson: unknown = await Bun.file("package.json").json()

    // When
    const manifest = PackageSchema.parse(packageJson)

    // Then
    expect({
      version: manifest.version,
      main: manifest.main,
      types: manifest.types,
      exports: manifest.exports,
    }).toEqual({
      version: "0.2.0",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      exports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
        "./command-code": {
          types: "./dist/sdk/command-code.d.ts",
          import: "./dist/sdk/command-code.js",
        },
        "./cursor": {
          types: "./dist/sdk/cursor.d.ts",
          import: "./dist/sdk/cursor.js",
        },
        "./ollama": {
          types: "./dist/sdk/ollama.d.ts",
          import: "./dist/sdk/ollama.js",
        },
      },
    })
  })

  it("runs the exact release lifecycle scripts", async () => {
    // Given
    const packageJson: unknown = await Bun.file("package.json").json()

    // When
    const manifest = PackageSchema.parse(packageJson)

    // Then
    expect({
      prepack: manifest.scripts["prepack"],
      verifyPackage: manifest.scripts["verify:package"],
      testE2e: manifest.scripts["test:e2e"],
    }).toEqual({
      prepack: "bun run build",
      verifyPackage: "bun pm pack --dry-run",
      testE2e:
        "bun run build && bun test tests/e2e/opencode-legacy-loader.test.ts tests/e2e/opencode-provider-lifecycle.test.ts tests/e2e/ollama-lifecycle.test.ts tests/e2e/opencode-package-install.test.ts",
    })
  })
})
