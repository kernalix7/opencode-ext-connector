import { describe, expect, it } from "bun:test"

import { parseKeychainAccount } from "../../../../src/providers/claude/keychain-account"

describe("parseKeychainAccount", () => {
  it("reads acct blob from security find-generic-password dump", () => {
    // Given
    const dump = [
      'keychain: "/Users/x/Library/Keychains/login.keychain-db"',
      'class: "genp"',
      "attributes:",
      '    0x00000007 <blob>="Claude Code-credentials"',
      '    "acct"<blob>="claude-ai-oauth"',
    ].join("\n")
    // When
    const account = parseKeychainAccount(dump)
    // Then
    expect(account).toBe("claude-ai-oauth")
  })

  it("returns null when acct is missing", () => {
    // Given / When / Then
    expect(parseKeychainAccount("class: genp")).toBeNull()
  })
})
