import { describe, expect, it } from "bun:test"
import { pathToFileURL } from "node:url"

import { getTestPackageRoot, prepareTestPackage, TEST_PACKAGE_ROOT_ENV } from "./test-package"

describe("test package preparation", () => {
  it("keeps each preparation importable after another preparation is cleaned", async () => {
    // Given
    const first = await prepareTestPackage()
    const second = await prepareTestPackage()

    try {
      expect(first.root).not.toBe(second.root)

      // When
      await first.cleanup()
      const loaded: unknown = await import(pathToFileURL(`${second.dist}/index.js`).href)

      // Then
      expect(loaded).toBeDefined()
    } finally {
      await first.cleanup()
      await second.cleanup()
    }
  }, 30_000)

  it("rejects a missing prepared package root instead of falling back to the project", () => {
    // Given
    const environment = { [TEST_PACKAGE_ROOT_ENV]: undefined }

    // When / Then
    expect(() => getTestPackageRoot(environment)).toThrow()
  })
})
