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
    expect(written.filter((path) => path.endsWith(".credentials.json"))).toEqual([
      "/tmp/claude-wb/.credentials.json",
      ...claudeWindowsCredentialPaths({ APPDATA: "C:\\Users\\x\\AppData\\Roaming" }),
    ])
    expect(written.some((path) => path.endsWith("auth.json"))).toBe(true)
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

  it("merges OpenCode auth.json without dropping other providers", async () => {
    // Given
    const files = new Map<string, string>()
    // When
    await writeClaudeCredentials(
      { XDG_DATA_HOME: "/xdg-data" },
      { accessToken: "access", refreshToken: "refresh", expiresAtMs: 9 },
      {
        platform: "linux",
        readFile: async (path) =>
          path.endsWith("auth.json") ? JSON.stringify({ openai: { type: "api" } }) : null,
        writeFile: async (path, body) => {
          files.set(path, body)
        },
      },
    )
    // Then
    const auth = [...files.entries()].find(([path]) => path.endsWith("auth.json"))
    expect(auth).toBeDefined()
    if (auth !== undefined) {
      const parsed = JSON.parse(auth[1])
      expect(parsed.openai).toEqual({ type: "api" })
      expect(parsed.anthropic.type).toBe("oauth")
      expect(parsed.anthropic.access).toBe("access")
    }
  })
})
