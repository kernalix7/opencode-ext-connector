import { describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { packCleanSource } from "./packed-package"

const projectRoot = join(import.meta.dir, "..", "..")

describe("clean-source package packing", () => {
  it("builds an actual tarball from a staged source without dist", async () => {
    // Given
    let inspectedCleanSource = false

    // When
    const packed = await packCleanSource({
      projectRoot,
      beforePack: async (sourceDirectory) => {
        inspectedCleanSource = true
        expect(existsSync(join(sourceDirectory, "dist"))).toBe(false)
      },
    })

    try {
      // Then
      expect(inspectedCleanSource).toBe(true)
      expect(packed.tarballPath.endsWith("opencode-ext-connector-0.2.0.tgz")).toBe(true)
      expect(existsSync(packed.tarballPath)).toBe(true)
    } finally {
      await packed.cleanup()
    }
  }, 20_000)
})
