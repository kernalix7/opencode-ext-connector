import { afterEach, describe, expect, it } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createXaiConsumerAuth,
  XaiAccessUnavailableError,
} from "../../../../src/providers/xai/consumer-auth"
import { FakeClock } from "../../../support/clock"

const directories: string[] = []
async function fixture(): Promise<{ readonly home: string; readonly path: string }> {
  const home = await mkdtemp(join(tmpdir(), "xai-consumer-"))
  directories.push(home)
  await mkdir(join(home, "opencode"))
  return { home, path: join(home, "opencode", "xai-access.json") }
}
async function ready(path: string, access: string, expires = 20_000): Promise<void> {
  await writeFile(
    path,
    JSON.stringify({ schema_version: 1, provider: "xai", state: "ready", access, expires }),
    { mode: 0o600 },
  )
  await chmod(path, 0o600)
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("xAI V1 consumer", () => {
  it("installs fetch only for the exact CLI marker", async () => {
    // Given
    const { home } = await fixture()
    const auth = createXaiConsumerAuth({
      env: { XDG_DATA_HOME: home },
      clock: new FakeClock(10_000),
      networkFetch: async () => new Response(null, { status: 204 }),
    })
    // When
    const selected = await auth.loader(async () => ({ type: "api", key: "cli-session:xai" }))
    const native = await auth.loader(async () => ({ type: "api", key: "native-secret" }))
    // Then
    expect(auth.provider).toBe("xai")
    expect(auth.methods).toEqual([])
    expect(selected.apiKey).toBe("xai-access-file")
    expect(typeof selected.fetch).toBe("function")
    expect(native).toEqual({})
  })

  it("rereads rotated access on successive calls from one loader", async () => {
    // Given
    const { home, path } = await fixture()
    await ready(path, "first")
    const seen: string[] = []
    const retained: string[] = []
    const auth = createXaiConsumerAuth({
      env: { XDG_DATA_HOME: home },
      clock: new FakeClock(10_000),
      networkFetch: async (_input, init) => {
        seen.push(new Headers(init?.headers).get("authorization") ?? "")
        retained.push(new Headers(init?.headers).get("x-original") ?? "")
        expect(new Headers(init?.headers).get("x-extra")).toBe(seen.length === 1 ? "kept" : null)
        expect(init?.redirect).toBe("error")
        return new Response(null, { status: 204 })
      },
    })
    const selected = await auth.loader(async () => ({ type: "api", key: "cli-session:xai" }))
    if (!selected.fetch) throw new Error("missing consumer fetch")
    const request = new Request("https://api.x.ai/v1/models?page=2", {
      headers: { Authorization: "stale", "x-original": "kept" },
    })
    // When
    await selected.fetch(request, {
      headers: { AUTHORIZATION: "older", "x-extra": "kept" },
      signal: null,
    })
    await ready(path, "second")
    await selected.fetch(request)
    // Then
    expect(seen).toEqual(["Bearer first", "Bearer second"])
    expect(retained).toEqual(["kept", "kept"])
  })

  it.each(["missing", "malformed", "expired"])(
    "fails closed for %s source before any transport",
    async (kind) => {
      // Given
      const { home, path } = await fixture()
      if (kind === "malformed") await writeFile(path, "not-json", { mode: 0o600 })
      if (kind === "expired") await ready(path, "old", 10_000)
      let calls = 0
      const auth = createXaiConsumerAuth({
        env: { XDG_DATA_HOME: home },
        clock: new FakeClock(10_000),
        networkFetch: async () => {
          calls++
          return new Response()
        },
      })
      const selected = await auth.loader(async () => ({ type: "api", key: "cli-session:xai" }))
      if (!selected.fetch) throw new Error("missing consumer fetch")
      // When
      const sent = selected.fetch("https://api.x.ai/v1/models")
      // Then
      await expect(sent).rejects.toBeInstanceOf(XaiAccessUnavailableError)
      expect(calls).toBe(0)
    },
  )

  it("rejects foreign targets before reading even a missing access file", async () => {
    // Given
    const { home } = await fixture()
    const auth = createXaiConsumerAuth({
      env: { XDG_DATA_HOME: home },
      clock: new FakeClock(10_000),
      networkFetch: async () => new Response(),
    })
    const selected = await auth.loader(async () => ({ type: "api", key: "cli-session:xai" }))
    if (!selected.fetch) throw new Error("missing consumer fetch")
    // When
    const sent = selected.fetch("https://foreign.example/v1/models")
    // Then
    await expect(sent).rejects.toMatchObject({ name: "XaiTargetError" })
  })

  it("rejects a selected marker change rather than silently using the replacement", async () => {
    // Given
    const { home, path } = await fixture()
    await ready(path, "A")
    let marker = "cli-session:xai"
    let calls = 0
    const auth = createXaiConsumerAuth({
      env: { XDG_DATA_HOME: home },
      clock: new FakeClock(10_000),
      networkFetch: async () => {
        calls++
        return new Response()
      },
    })
    const selected = await auth.loader(async () => ({ type: "api", key: marker }))
    if (!selected.fetch) throw new Error("missing consumer fetch")
    // When
    marker = "native-key"
    const sent = selected.fetch("https://api.x.ai/v1/models")
    // Then
    await expect(sent).rejects.toBeInstanceOf(XaiAccessUnavailableError)
    expect(calls).toBe(0)
  })

  it("rejects an already-bound attempt rotated while the host gate is paused", async () => {
    // Given
    const { home, path } = await fixture()
    await ready(path, "A")
    let calls = 0
    let reads = 0
    let releaseGate: (() => void) | undefined
    let reachedGate: (() => void) | undefined
    const reached = new Promise<void>((resolve) => {
      reachedGate = resolve
    })
    const pause = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    const auth = createXaiConsumerAuth({
      env: { XDG_DATA_HOME: home },
      clock: new FakeClock(10_000),
      networkFetch: async () => {
        calls++
        return new Response()
      },
    })
    const selected = await auth.loader(async () => {
      reads++
      if (reads === 4) {
        reachedGate?.()
        await pause
      }
      return { type: "api", key: "cli-session:xai" }
    })
    if (!selected.fetch) throw new Error("missing consumer fetch")
    // When
    const sent = selected.fetch("https://api.x.ai/v1/models")
    await reached
    await ready(path, "B")
    releaseGate?.()
    // Then
    await expect(sent).rejects.toBeInstanceOf(XaiAccessUnavailableError)
    expect(calls).toBe(0)
  })

  it("merges caller signals and closes an in-flight request with identical disposal promises", async () => {
    // Given
    const { home, path } = await fixture()
    await ready(path, "A")
    const caller = new AbortController()
    let sentSignal: AbortSignal | undefined
    const auth = createXaiConsumerAuth({
      env: { XDG_DATA_HOME: home },
      clock: new FakeClock(10_000),
      networkFetch: async (_input, init) => {
        sentSignal = init?.signal ?? undefined
        return new Response(null, { status: 204 })
      },
    })
    const selected = await auth.loader(async () => ({ type: "api", key: "cli-session:xai" }))
    if (!selected.fetch) throw new Error("missing consumer fetch")
    // When
    await selected.fetch(new Request("https://api.x.ai/v1/models"), { signal: caller.signal })
    const closed = auth.dispose()
    // Then
    expect(auth.dispose()).toBe(closed)
    expect(sentSignal?.aborted).toBe(true)
    await expect(selected.fetch("https://api.x.ai/v1/models")).rejects.toBeInstanceOf(
      XaiAccessUnavailableError,
    )
  })

  it("honors caller cancellation before transport and propagates selected getter errors", async () => {
    // Given
    const { home, path } = await fixture()
    await ready(path, "A")
    let calls = 0
    let fails = false
    const auth = createXaiConsumerAuth({
      env: { XDG_DATA_HOME: home },
      clock: new FakeClock(10_000),
      networkFetch: async () => {
        calls++
        return new Response()
      },
    })
    const selected = await auth.loader(async () => {
      if (fails) throw new TypeError("host getter failed")
      return { type: "api", key: "cli-session:xai" }
    })
    if (!selected.fetch) throw new Error("missing consumer fetch")
    const caller = new AbortController()
    caller.abort()
    // When
    const cancelled = selected.fetch("https://api.x.ai/v1/models", { signal: caller.signal })
    // Then
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" })
    fails = true
    await expect(selected.fetch("https://api.x.ai/v1/models")).rejects.toThrow("host getter failed")
    expect(calls).toBe(0)
  })
})
