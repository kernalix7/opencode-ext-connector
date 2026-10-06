import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { z } from "zod"

import { HostV2 as Host } from "../../../src/opencode/beta-api"
import { getTestPackageRoot } from "../../support/test-package"

const v1ExportNames = [
  "claudeAuthServer",
  "commandCodeAuthServer",
  "connectorServer",
  "cursorAuthServer",
  "ollamaAuthServer",
  "xaiAuthServer",
] as const

const isFunction = (value: unknown): boolean => typeof value === "function"

const V1ModuleSchema = z
  .object({
    claudeAuthServer: z.unknown().refine(isFunction),
    commandCodeAuthServer: z.unknown().refine(isFunction),
    connectorServer: z.unknown().refine(isFunction),
    cursorAuthServer: z.unknown().refine(isFunction),
    ollamaAuthServer: z.unknown().refine(isFunction),
    xaiAuthServer: z.unknown().refine(isFunction),
  })
  .strict()

const V2ServerModuleSchema = z
  .object({
    default: z.object({
      id: z.literal("opencode-ext-connector"),
      setup: z.unknown().refine(isFunction),
      server: z.never().optional(),
    }),
  })
  .strict()

const PackageSchema = z.object({
  version: z.string(),
  main: z.string(),
  types: z.string(),
  exports: z.record(z.string(), z.object({ types: z.string(), import: z.string() })),
  scripts: z
    .object({
      prepack: z.string(),
      "verify:package": z.string(),
      "test:e2e": z.string(),
    })
    .catchall(z.string()),
})

describe("package exports", () => {
  it("publishes the exact 0.8.0 package entry points", async () => {
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
      version: "0.8.0",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      exports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
        "./xai": { types: "./dist/xai.d.ts", import: "./dist/xai.js" },
        "./claude": { types: "./dist/sdk/claude.d.ts", import: "./dist/sdk/claude.js" },
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
        "./server": {
          types: "./dist/index.d.ts",
          import: "./dist/index.js",
        },
        "./v2": {
          types: "./dist/v2.d.ts",
          import: "./dist/v2.js",
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
      prepack: manifest.scripts.prepack,
      verifyPackage: manifest.scripts["verify:package"],
      testE2e: manifest.scripts["test:e2e"],
    }).toEqual({
      prepack: "bun run build",
      verifyPackage: "bun pm pack --dry-run",
      testE2e:
        "bun test tests/e2e/opencode-legacy-loader.test.ts tests/e2e/opencode-provider-lifecycle.test.ts tests/e2e/ollama-lifecycle.test.ts tests/e2e/opencode-package-install.test.ts",
    })
  })

  it("resolves the server alias to the V1 root", () => {
    // Given
    const root = getTestPackageRoot()
    const rootFile = pathToFileURL(join(root, "dist", "index.js")).href
    const publishedServer = pathToFileURL(
      Bun.resolveSync("opencode-ext-connector/server", root),
    ).href

    // When
    const entrypoints = Host.resolve({
      directory: root,
      name: "opencode-ext-connector",
    })

    // Then
    expect(entrypoints.server).toBe(rootFile)
    expect(entrypoints.server).toBe(publishedServer)
  })

  it("keeps the built package root on the six V1 named functions", async () => {
    // Given
    const root = getTestPackageRoot()
    const rootFile = pathToFileURL(join(root, "dist", "index.js")).href
    const resolvedRoot = pathToFileURL(Bun.resolveSync("opencode-ext-connector", root)).href

    // When
    const loaded: unknown = await import(resolvedRoot)

    // Then
    expect(resolvedRoot).toBe(rootFile)
    expect(Object.keys(V1ModuleSchema.parse(loaded)).sort()).toEqual([...v1ExportNames].sort())
  })

  it("loads the resolved server with only the six V1 named functions", async () => {
    // Given
    const root = getTestPackageRoot()
    const server = z
      .string()
      .parse(Host.resolve({ directory: root, name: "opencode-ext-connector" }).server)

    // When
    const loaded: unknown = await Host.load(server)

    // Then
    expect(Object.keys(V1ModuleSchema.parse(loaded)).sort()).toEqual([...v1ExportNames].sort())
  })

  it("keeps the V2 subpath on the default-only plugin", async () => {
    // Given
    const root = getTestPackageRoot()
    const v2File = pathToFileURL(join(root, "dist", "v2.js")).href
    const resolvedV2 = pathToFileURL(Bun.resolveSync("opencode-ext-connector/v2", root)).href

    // When
    const loaded: unknown = await import(resolvedV2)

    // Then
    expect(resolvedV2).toBe(v2File)
    expect(Object.keys(V2ServerModuleSchema.parse(loaded))).toEqual(["default"])
  })
})
