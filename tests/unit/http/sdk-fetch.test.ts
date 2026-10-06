import { expect, it } from "bun:test"

import { createSdkFetch } from "../../../src/http/sdk-fetch"
import { FakeHttpTransport } from "../../support/http"

it("preserves request bytes, response status and stream through the injected transport", async () => {
  // Given
  const transport = new FakeHttpTransport()
  transport.enqueueChunkedResponse({
    status: 401,
    statusText: "Unauthorized",
    headers: { "x-error": "test" },
    body: new TextEncoder().encode("denied"),
  })
  const sdkFetch = createSdkFetch(transport)

  // When
  const response = await sdkFetch("https://example.invalid/models", {
    method: "POST",
    headers: { authorization: "Bearer fake-key" },
    body: "request",
  })

  // Then
  expect(response.status).toBe(401)
  expect(response.statusText).toBe("Unauthorized")
  expect(response.headers.get("x-error")).toBe("test")
  expect(await response.text()).toBe("denied")
  expect(transport.requests[0]?.body).toEqual(new TextEncoder().encode("request"))
})

it("rejects a redirect before exposing a credential-bearing follow-up", async () => {
  // Given
  const transport = new FakeHttpTransport()
  transport.enqueueResponse({
    status: 302,
    headers: { location: "https://other.invalid/" },
    body: new Uint8Array(),
  })

  // When
  const response = createSdkFetch(transport)("https://example.invalid", {
    headers: { authorization: "Bearer fake-key" },
  })

  // Then
  await expect(response).rejects.toBeInstanceOf(TypeError)
  expect(transport.requests).toHaveLength(1)
})
