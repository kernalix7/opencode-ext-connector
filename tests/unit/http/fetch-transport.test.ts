import { expect, it } from "bun:test"

import { createFetchHttpTransport } from "../../../src/http/fetch-transport"

it("retains the legacy default fetch lookup after transport construction", async () => {
  // Given
  const original = globalThis.fetch
  const transport = createFetchHttpTransport()
  globalThis.fetch = Object.assign(async () => new Response("replacement"), {
    preconnect: original.preconnect,
  })
  try {
    // When
    const response = await transport.request(
      { method: "GET", url: "https://example.invalid", headers: {}, body: null },
      new AbortController().signal,
    )

    // Then
    expect(new TextDecoder().decode(response.body)).toBe("replacement")
  } finally {
    globalThis.fetch = original
  }
})

it("fails closed on redirects for buffered and streaming requests", async () => {
  // Given
  const redirects: Array<RequestInit["redirect"]> = []
  const transport = createFetchHttpTransport({
    fetch: async (_input, init) => {
      redirects.push(init?.redirect)
      return new Response("ok")
    },
  })
  const request = {
    method: "POST",
    url: "https://example.invalid",
    headers: {},
    body: null,
  } as const

  // When
  await transport.request(request, new AbortController().signal)
  await transport.stream?.(request, new AbortController().signal)

  // Then
  expect(redirects).toEqual(["error", "error"])
})
