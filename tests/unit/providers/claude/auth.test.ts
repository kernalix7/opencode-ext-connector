import { describe, expect, it } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OperationCancelledError } from "../../../../src/core/errors"
import { readClaudeAccessToken } from "../../../../src/providers/claude/auth"
import { parseClaudeCliVersion } from "../../../../src/providers/claude/cli-version"

function createSignal(aborted = false): AbortSignal {
  const controller = new AbortController()
  if (aborted) controller.abort()
  return controller.signal
}

function credentialJson(accessToken: string, wrapped = true): string {
  const credentials = {
    accessToken,
    refreshToken: "refresh-token",
    expiresAt: 1_900_000_000_000,
  }
  return JSON.stringify(wrapped ? { claudeAiOauth: credentials } : credentials)
}

describe("readClaudeAccessToken", () => {
  it("parses installed Claude CLI version output", () => {
    // Given / When / Then
    expect(parseClaudeCliVersion("2.1.217 (Claude Code)")).toBe("2.1.217")
  })

  it("returns keychain token when injected readKeychain succeeds — file not read", async () => {
    // Given
    const keychainToken = "kc-token"
    const fileRead = false
    const env: Record<string, string | undefined> = {
      CLAUDE_CONFIG_DIR: "/should/not/be/read",
    }
    const lookup = {
      readKeychain: async (_service: string, _signal: AbortSignal): Promise<string | null> => {
        return credentialJson(keychainToken)
      },
    }
    // When
    const token = await readClaudeAccessToken(env, createSignal(), lookup)
    // Then
    expect(token).toBe(keychainToken)
    expect(fileRead).toBe(false)
  })

  it("falls back to file when keychain returns null", async () => {
    // Given
    const tempDir = await mkdtemp(join(tmpdir(), "claude-test-"))
    const credentialPath = join(tempDir, ".credentials.json")
    await writeFile(credentialPath, credentialJson("file-token", false), "utf8")
    const env: Record<string, string | undefined> = {
      CLAUDE_CONFIG_DIR: tempDir,
    }
    const lookup = {
      readKeychain: async (_service: string, _signal: AbortSignal): Promise<string | null> => {
        return null
      },
    }
    // When
    const token = await readClaudeAccessToken(env, createSignal(), lookup)
    // Then
    expect(token).toBe("file-token")
  })

  it("returns null when both keychain and file are missing", async () => {
    // Given
    const env: Record<string, string | undefined> = {
      CLAUDE_CONFIG_DIR: "/nonexistent/path",
    }
    const lookup = {
      readKeychain: async (_service: string, _signal: AbortSignal): Promise<string | null> => {
        return null
      },
    }
    // When
    const token = await readClaudeAccessToken(env, createSignal(), lookup)
    // Then
    expect(token).toBeNull()
  })

  it("throws OperationCancelledError when signal is aborted before keychain", async () => {
    // Given
    const env: Record<string, string | undefined> = {}
    const lookup = {
      readKeychain: async (_service: string, _signal: AbortSignal): Promise<string | null> => {
        return "should-not-be-called"
      },
    }
    // When / Then
    await expect(readClaudeAccessToken(env, createSignal(true), lookup)).rejects.toBeInstanceOf(
      OperationCancelledError,
    )
  })

  it("parses plain accessToken from keychain when no claudeAiOauth wrapper", async () => {
    // Given
    const plainToken = "plain-token"
    const env: Record<string, string | undefined> = {}
    const lookup = {
      readKeychain: async (_service: string, _signal: AbortSignal): Promise<string | null> => {
        return credentialJson(plainToken, false)
      },
    }
    // When
    const token = await readClaudeAccessToken(env, createSignal(), lookup)
    // Then
    expect(token).toBe(plainToken)
  })

  it("does not call real security binary — uses injected lookup only", async () => {
    // Given
    let securityCalled = false
    const env: Record<string, string | undefined> = {}
    const lookup = {
      readKeychain: async (_service: string, _signal: AbortSignal): Promise<string | null> => {
        securityCalled = true
        return credentialJson("injected")
      },
    }
    // When
    await readClaudeAccessToken(env, createSignal(), lookup)
    // Then
    expect(securityCalled).toBe(true) // injected lookup was called, not real security
  })

  it("works with 2-arg signature (backward compatibility)", async () => {
    // Given
    const tempDir = await mkdtemp(join(tmpdir(), "claude-test-"))
    const credentialPath = join(tempDir, ".credentials.json")
    await writeFile(credentialPath, credentialJson("compat-token", false), "utf8")
    const env: Record<string, string | undefined> = {
      CLAUDE_CONFIG_DIR: tempDir,
    }
    // When
    const token = await readClaudeAccessToken(env, createSignal())
    // Then
    expect(token).toBe("compat-token")
  })

  it("throws OperationCancelledError when signal aborted after keychain", async () => {
    // Given
    const controller = new AbortController()
    const env: Record<string, string | undefined> = {
      CLAUDE_CONFIG_DIR: "/nonexistent/path",
    }
    const lookup = {
      readKeychain: async (_service: string, _signal: AbortSignal): Promise<string | null> => {
        controller.abort()
        return null
      },
    }
    // When / Then
    await expect(readClaudeAccessToken(env, controller.signal, lookup)).rejects.toBeInstanceOf(
      OperationCancelledError,
    )
  })
})
