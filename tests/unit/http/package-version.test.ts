import { describe, expect, it } from "bun:test"

import { createPackageVersionResolver } from "../../../src/http/package-version"
import { FakeHttpTransport } from "../../support/http"

function registryResponse(
  payload: unknown,
  status = 200,
): {
  readonly status: number
  readonly headers: Record<string, string>
  readonly body: Uint8Array
} {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: new TextEncoder().encode(JSON.stringify(payload)),
  }
}

describe("createPackageVersionResolver", () => {
  it("reads the latest published version from the npm registry", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse(registryResponse({ name: "@scope/tool", version: "3.4.5" }))
    const resolve = createPackageVersionResolver({ transport, packageName: "@scope/tool" })

    // When
    const version = await resolve(new AbortController().signal)

    // Then
    expect(version).toBe("3.4.5")
    expect(transport.requests).toEqual([
      {
        method: "GET",
        url: "https://registry.npmjs.org/%40scope%2Ftool/latest",
        headers: { accept: "application/json" },
        body: null,
      },
    ])
  })

  it("caches the first successful lookup and shares in-flight requests", async () => {
    // Given
    const transport = new FakeHttpTransport()
    const pending = transport.enqueuePending()
    const resolve = createPackageVersionResolver({ transport, packageName: "tool" })
    const signal = new AbortController().signal

    // When
    const first = resolve(signal)
    const second = resolve(signal)
    pending.resolve(registryResponse({ version: "1.2.3" }))
    const third = await resolve(signal)

    // Then
    expect(await Promise.all([first, second])).toEqual(["1.2.3", "1.2.3"])
    expect(third).toBe("1.2.3")
    expect(transport.requests).toHaveLength(1)
  })

  it.each([
    ["non-2xx status", registryResponse({ version: "1.2.3" }, 503)],
    ["malformed json", { status: 200, headers: {}, body: new TextEncoder().encode("{") }],
    ["missing version", registryResponse({ name: "tool" })],
    ["non-semver version", registryResponse({ version: "latest" })],
  ])("returns null and retries later after %s", async (_label, response) => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse(response)
    transport.enqueueResponse(registryResponse({ version: "2.0.0" }))
    const resolve = createPackageVersionResolver({ transport, packageName: "tool" })
    const signal = new AbortController().signal

    // When
    const failed = await resolve(signal)
    const recovered = await resolve(signal)

    // Then
    expect(failed).toBeNull()
    expect(recovered).toBe("2.0.0")
    expect(transport.requests).toHaveLength(2)
  })

  it("returns null when the transport fails", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueError(new Error("offline"))
    const resolve = createPackageVersionResolver({ transport, packageName: "tool" })

    // When
    const version = await resolve(new AbortController().signal)

    // Then
    expect(version).toBeNull()
  })
})
