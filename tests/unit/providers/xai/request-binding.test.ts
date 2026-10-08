import { afterEach, describe, expect, it } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createXaiRequestBindings,
  XaiAccessUnavailableError,
} from "../../../../src/providers/xai/request-binding"
import { assertXaiTarget, XaiTargetError } from "../../../../src/providers/xai/targets"
import { FakeClock } from "../../../support/clock"

const directories: string[] = []
async function fixture(): Promise<{
  readonly env: { XDG_DATA_HOME: string }
  readonly path: string
}> {
  const home = await mkdtemp(join(tmpdir(), "xai-binding-"))
  directories.push(home)
  await mkdir(join(home, "opencode"))
  return { env: { XDG_DATA_HOME: home }, path: join(home, "opencode", "xai-access.json") }
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

describe("xAI attempt binding", () => {
  it("refuses to adopt another token while a new attempt can bind the rotation", async () => {
    // Given
    const { env, path } = await fixture()
    await ready(path, "A")
    const bindings = createXaiRequestBindings({ env, clock: new FakeClock(10_000) })
    const old = await bindings.begin()
    // When
    await ready(path, "B")
    const newAttempt = await bindings.begin()
    // Then
    await expect(bindings.revalidate(old)).rejects.toBeInstanceOf(XaiAccessUnavailableError)
    expect(await bindings.revalidate(newAttempt)).toBe("B")
  })

  it("revokes a captured attempt on expiry, gate closure and disposal", async () => {
    // Given
    const { env, path } = await fixture()
    await ready(path, "A")
    const clock = new FakeClock(10_000)
    let enabled = true
    const bindings = createXaiRequestBindings({ env, clock, gate: () => enabled })
    const attempt = await bindings.begin()
    // When
    enabled = false
    // Then
    await expect(bindings.revalidate(attempt)).rejects.toBeInstanceOf(XaiAccessUnavailableError)
    enabled = true
    clock.advanceBy(10_000)
    await expect(bindings.revalidate(attempt)).rejects.toBeInstanceOf(XaiAccessUnavailableError)
    const closed = bindings.dispose()
    expect(bindings.dispose()).toBe(closed)
    await expect(bindings.revalidate(attempt)).rejects.toBeInstanceOf(XaiAccessUnavailableError)
  })

  it("does not accept a binding from another owner or a changed source path", async () => {
    // Given
    const first = await fixture()
    const second = await fixture()
    await ready(first.path, "same")
    await ready(second.path, "same")
    const env: { XDG_DATA_HOME: string } = { ...first.env }
    const owner = createXaiRequestBindings({ env, clock: new FakeClock(10_000) })
    const foreign = createXaiRequestBindings({ env: first.env, clock: new FakeClock(10_000) })
    const attempt = await owner.begin()
    // When
    env.XDG_DATA_HOME = second.env.XDG_DATA_HOME
    // Then
    await expect(owner.revalidate(attempt)).rejects.toBeInstanceOf(XaiAccessUnavailableError)
    await expect(foreign.revalidate(attempt)).rejects.toBeInstanceOf(XaiAccessUnavailableError)
  })
})

describe("xAI target policy", () => {
  it.each([
    "https://evil.test/v1/models",
    "http://api.x.ai/v1/models",
    "https://api.x.ai:9443/v1/models",
    "https://user:password@api.x.ai/v1/models",
    "https://api.x.ai/v10/models",
    "https://api.x.ai/v1/models?access_token=secret",
    "https://api.x.ai/v1/models?API_KEY=secret",
  ])("rejects an unsafe HTTP target %s", (url) => {
    // Given / When / Then
    expect(() => assertXaiTarget(url, "http")).toThrow(XaiTargetError)
  })

  it("allows ordinary pagination and only secure WebSocket handshakes", () => {
    // Given / When / Then
    expect(() => assertXaiTarget("https://api.x.ai/v1/models?page=2", "http")).not.toThrow()
    expect(() => assertXaiTarget("wss://api.x.ai/v1/realtime", "ws")).not.toThrow()
    expect(() => assertXaiTarget("ws://api.x.ai/v1/realtime", "ws")).toThrow(XaiTargetError)
  })
})
