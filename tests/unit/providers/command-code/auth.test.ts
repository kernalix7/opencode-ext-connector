import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readCommandCodeAccessToken } from "../../../../src/providers/command-code/auth"

describe("readCommandCodeAccessToken", () => {
  it("prefers official COMMAND_CODE_API_KEY", async () => {
    // Given
    const env = { COMMAND_CODE_API_KEY: "official", COMMANDCODE_API_KEY: "legacy" }
    // When
    const token = await readCommandCodeAccessToken(env, new AbortController().signal)
    // Then
    expect(token).toBe("official")
  })

  it("reads ~/.commandcode/auth.json", async () => {
    // Given
    const homeDir = await mkdtemp(join(tmpdir(), "cc-auth-"))
    const configDir = join(homeDir, ".commandcode")
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, "auth.json"), '{"apiKey":"from-file"}', { encoding: "utf8" })
    // When
    const token = await readCommandCodeAccessToken({}, new AbortController().signal, { homeDir })
    // Then
    expect(token).toBe("from-file")
  })
})
