import { describe, expect, it } from "bun:test"

import { parseCommandCodeCliVersion } from "../../../../src/providers/command-code/cli-version"

describe("parseCommandCodeCliVersion", () => {
  it("reads a semver from CLI stdout", () => {
    // Given / When / Then
    expect(parseCommandCodeCliVersion("1.27.1\n")).toBe("1.27.1")
  })

  it("returns null when stdout has no version", () => {
    // Given / When / Then
    expect(parseCommandCodeCliVersion("not a version")).toBeNull()
  })
})
