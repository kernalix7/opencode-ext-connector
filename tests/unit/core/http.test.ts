import { describe, expect, it } from "bun:test"

import { HttpTransportError, OperationCancelledError } from "../../../src/core/errors"
import type { HttpRequest, HttpResponse } from "../../../src/core/http"
import { FakeHttpTransport } from "../../support/http"

const request: HttpRequest = { method: "GET", url: "https://example.test", headers: {}, body: null }
const response: HttpResponse = {
  status: 200,
  headers: { "content-type": "text/plain" },
  body: new Uint8Array([1]),
}

describe("FakeHttpTransport", () => {
  it("returns queued responses and records cloned requests", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueueResponse(response)
    // When
    const result = await transport.request(request, new AbortController().signal)
    // Then
    expect(result).toEqual(response)
    expect(transport.requests).toEqual([request])
    expect(result).not.toBe(response)
  })

  it("surfaces queued failures", async () => {
    // Given
    const transport = new FakeHttpTransport()
    const failure = new HttpTransportError({ operation: "request", retryable: true, cause: null })
    transport.enqueueError(failure)
    // When
    const promise = transport.request(request, new AbortController().signal)
    // Then
    await expect(promise).rejects.toBe(failure)
  })

  it("rejects pre-aborted requests without recording", async () => {
    // Given
    const transport = new FakeHttpTransport()
    const controller = new AbortController()
    controller.abort()
    // When
    const promise = transport.request(request, controller.signal)
    // Then
    await expect(promise).rejects.toBeInstanceOf(OperationCancelledError)
    expect(transport.requests).toEqual([])
  })

  it("cancels pending requests", async () => {
    // Given
    const transport = new FakeHttpTransport()
    transport.enqueuePending()
    const controller = new AbortController()
    const promise = transport.request(request, controller.signal)
    // When
    controller.abort()
    // Then
    await expect(promise).rejects.toBeInstanceOf(OperationCancelledError)
  })
})
