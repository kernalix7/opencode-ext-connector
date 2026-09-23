import { afterEach, describe, expect, it } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createXaiConsumerAuth,
  type NetworkFetch,
} from "../../../../src/providers/xai/consumer-auth"
import { FakeClock } from "../../../support/clock"

const temporaryDirectories: string[] = []

async function fixture(): Promise<{ readonly dataHome: string; readonly path: string }> {
  const dataHome = await mkdtemp(join(tmpdir(), "xai-consumer-auth-"))
  temporaryDirectories.push(dataHome)
  await mkdir(join(dataHome, "opencode"))
  return { dataHome, path: join(dataHome, "opencode", "xai-access.json") }
}

async function writeReady(path: string, access: string, expires = 20_000): Promise<void> {
  await writeFile(
    path,
    JSON.stringify({ schema_version: 1, provider: "xai", state: "ready", access, expires }),
    { mode: 0o600 },
  )
  await chmod(path, 0o600)
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe("xAI consumer auth", () => {
  it("exposes no login methods and activates only for the fixed API marker", async () => {
    // Given
    const { dataHome } = await fixture()
    const auth = createXaiConsumerAuth({
      env: { XDG_DATA_HOME: dataHome },
      clock: new FakeClock(),
      networkFetch: async () => new Response(null, { status: 204 }),
    })

    // When
    const accepted = await auth.loader(async () => ({
      type: "api" as const,
      key: "cli-session:xai",
    }))
    const rejected = await Promise.all([
      auth.loader(async () => ({ type: "api" as const, key: "other-marker" })),
      auth.loader(async () => ({
        type: "oauth" as const,
        access: "access",
        refresh: "",
        expires: 0,
      })),
    ])

    // Then
    expect(auth.provider).toBe("xai")
    expect(auth.methods).toEqual([])
    expect(accepted).toMatchObject({ apiKey: "xai-access-file" })
    expect(typeof accepted.fetch).toBe("function")
    expect(rejected).toEqual([{}, {}])
  })

  it("rereads access for every request and overwrites Authorization case-insensitively", async () => {
    // Given
    const { dataHome, path } = await fixture()
    await writeReady(path, "access-one")
    const calls: { readonly input: string | URL | Request; readonly init?: RequestInit }[] = []
    const networkFetch: NetworkFetch = async (input, init) => {
      calls.push(init === undefined ? { input } : { input, init })
      return new Response(null, { status: 204 })
    }
    const auth = createXaiConsumerAuth({
      env: { XDG_DATA_HOME: dataHome },
      clock: new FakeClock(10_000),
      networkFetch,
    })
    const loaded = await auth.loader(async () => ({
      type: "api" as const,
      key: "cli-session:xai",
    }))
    if (typeof loaded.fetch !== "function") throw new Error("xAI fetch was not installed")
    const request = new Request("https://api.x.ai/v1/models", {
      headers: { authorization: "Bearer stale", "x-request": "kept" },
    })

    // When
    await loaded.fetch(request, { headers: { AUTHORIZATION: "Bearer older", "x-init": "kept" } })
    await writeReady(path, "access-two")
    await loaded.fetch(request)

    // Then
    expect(calls).toHaveLength(2)
    expect(new Headers(calls[0]?.init?.headers)).toEqual(
      new Headers({ authorization: "Bearer access-one", "x-init": "kept", "x-request": "kept" }),
    )
    expect(new Headers(calls[1]?.init?.headers).get("authorization")).toBe("Bearer access-two")
  })

  it.each([
    ["missing", undefined],
    ["malformed", "not-json"],
    ["unavailable", JSON.stringify({ schema_version: 1, provider: "xai", state: "unavailable" })],
    [
      "expired",
      JSON.stringify({
        schema_version: 1,
        provider: "xai",
        state: "ready",
        access: "expired-access",
        expires: 10_000,
      }),
    ],
  ] as const)("fails before network I/O for %s state", async (_case, body) => {
    // Given
    const { dataHome, path } = await fixture()
    if (body !== undefined) {
      await writeFile(path, body, { mode: 0o600 })
      await chmod(path, 0o600)
    }
    let networkCalls = 0
    const auth = createXaiConsumerAuth({
      env: { XDG_DATA_HOME: dataHome },
      clock: new FakeClock(10_000),
      networkFetch: async () => {
        networkCalls += 1
        return new Response(null, { status: 204 })
      },
    })
    const loaded = await auth.loader(async () => ({
      type: "api" as const,
      key: "cli-session:xai",
    }))
    if (typeof loaded.fetch !== "function") throw new Error("xAI fetch was not installed")

    // When
    const request = loaded.fetch("https://api.x.ai/v1/models")

    // Then
    await expect(request).rejects.toMatchObject({ name: "XaiAccessUnavailableError" })
    expect(networkCalls).toBe(0)
  })
})
