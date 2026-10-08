import { describe, expect, it } from "bun:test"
import type { AuthHook, PluginInput } from "@opencode-ai/plugin"
import { createOpencodeClient } from "@opencode-ai/sdk"

import { xaiAuthServer } from "../../src/index"
import { xaiAuthServer as dedicated } from "../../src/xai"

const input: PluginInput = {
  client: createOpencodeClient(),
  project: { id: "xai-entry", worktree: "/fixture", time: { created: 0 } },
  directory: "/fixture",
  worktree: "/fixture",
  experimental_workspace: { register: () => undefined },
  serverUrl: new URL("http://127.0.0.1"),
  $: Bun.$,
}
const provider: Parameters<NonNullable<AuthHook["loader"]>>[1] = {
  id: "xai",
  name: "xAI",
  source: "custom",
  env: [],
  options: {},
  models: {},
}

describe("public V1 xAI entries", () => {
  for (const [name, entry] of [
    ["root", xaiAuthServer],
    ["dedicated", dedicated],
  ] as const) {
    it(`${name} installs consumer auth with a marker-only loader and owned disposal`, async () => {
      // Given / When
      const hooks = await entry(input, { providers: [], xaiOAuth: { mode: "consumer" } })
      // Then
      expect(hooks.auth?.provider).toBe("xai")
      expect(hooks.auth?.methods).toEqual([])
      expect(hooks.auth).not.toHaveProperty("dispose")
      expect(typeof hooks.dispose).toBe("function")
      const loader = hooks.auth?.loader
      if (!loader) throw new TypeError("consumer loader missing")
      const selected = await loader(async () => ({ type: "api", key: "cli-session:xai" }), provider)
      expect(selected["apiKey"]).toBe("xai-access-file")
      expect(typeof selected["fetch"]).toBe("function")
      expect(await loader(async () => ({ type: "api", key: "native-key" }), provider)).toEqual({})
      await hooks.dispose?.()
      await expect(
        loader(async () => ({ type: "api", key: "cli-session:xai" }), provider),
      ).rejects.toThrow()
    })

    it(`${name} stays disabled in default and authority modes`, async () => {
      // Given / When / Then
      expect(await entry(input)).toEqual({})
      expect(await entry(input, { xaiOAuth: { mode: "authority" } })).toEqual({})
    })
  }
})
