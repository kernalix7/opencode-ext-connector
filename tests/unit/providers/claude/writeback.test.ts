import { describe, expect, it } from "bun:test"

import {
  claudeCredentialsFileBody,
  claudeKeychainWriteArgs,
  claudeWindowsCredentialPaths,
  writeClaudeCredentials,
} from "../../../../src/providers/claude/writeback"

describe("claudeCredentialsFileBody", () => {
  it("serializes oauth fields for .credentials.json", () => {
    // Given
    const credentials = {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAtMs: 1_700,
    }
    // When
    const body = JSON.parse(claudeCredentialsFileBody(credentials))
    // Then
    expect(body).toEqual({
      claudeAiOauth: {
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: 1_700,
      },
    })
  })

  it("builds security add-generic-password update args", () => {
    // Given
    const credentials = {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAtMs: 1_700,
    }
    // When
    const args = claudeKeychainWriteArgs(credentials, "Claude Code")
    // Then
    expect(args).toEqual([
      "add-generic-password",
      "-U",
      "-s",
      "Claude Code-credentials",
      "-a",
      "Claude Code",
      "-w",
      claudeCredentialsFileBody(credentials).trim(),
    ])
  })

  it("writes file, windows extra path, and keychain via hooks", async () => {
    // Given
    const written: string[] = []
    const keychain: string[][] = []
    const credentials = {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAtMs: 1_700,
    }
    // When
    await writeClaudeCredentials(
      { CLAUDE_CONFIG_DIR: "/tmp/claude-wb", APPDATA: "C:\\Users\\x\\AppData\\Roaming" },
      credentials,
      {
        platform: "win32",
        writeFile: async (path) => {
          written.push(path)
        },
        writeKeychain: async (args) => {
          keychain.push([...args])
        },
      },
    )
    // Then
    expect(written).toEqual([
      "/tmp/claude-wb/.credentials.json",
      ...claudeWindowsCredentialPaths({ APPDATA: "C:\\Users\\x\\AppData\\Roaming" }),
    ])
    expect(keychain).toEqual([])
  })

  it("writes the macOS keychain on darwin", async () => {
    // Given
    const keychain: string[][] = []
    // When
    await writeClaudeCredentials(
      { CLAUDE_CONFIG_DIR: "/tmp/claude-wb" },
      { accessToken: "a", refreshToken: "r", expiresAtMs: 1 },
      {
        platform: "darwin",
        writeFile: async () => undefined,
        writeKeychain: async (args) => {
          keychain.push([...args])
        },
      },
    )
    // Then
    expect(keychain.at(0)?.at(0)).toBe("add-generic-password")
    expect(keychain.at(0)).toContain("-U")
  })
})
