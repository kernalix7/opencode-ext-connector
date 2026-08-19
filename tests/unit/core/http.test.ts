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

  describe("stream()", () => {
    it("yields queued response body as chunks", async () => {
      // Given
      const transport = new FakeHttpTransport()
      const chunkedResponse: HttpResponse = {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: new Uint8Array([1, 2, 3, 4]),
      }
      transport.enqueueChunkedResponse(chunkedResponse)
      // When
      const result = await transport.stream(request, new AbortController().signal)
      const chunks: Uint8Array[] = []
      for await (const chunk of result.body) {
        chunks.push(chunk)
      }
      // Then
      expect(chunks.length).toBeGreaterThan(0)
      const concatenated = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0))
      let offset = 0
      for (const chunk of chunks) {
        concatenated.set(chunk, offset)
        offset += chunk.length
      }
      expect(Array.from(concatenated)).toEqual(Array.from(chunkedResponse.body))
      expect(result.status).toBe(chunkedResponse.status)
      expect(result.headers).toEqual(chunkedResponse.headers)
    })

    it("rejects pre-aborted stream without recording", async () => {
      // Given
      const transport = new FakeHttpTransport()
      const controller = new AbortController()
      controller.abort()
      // When
      const promise = transport.stream(request, controller.signal)
      // Then
      await expect(promise).rejects.toBeInstanceOf(OperationCancelledError)
      expect(transport.requests).toEqual([])
    })

    it("cancels ongoing stream", async () => {
      // Given
      const transport = new FakeHttpTransport()
      const chunkedResponse: HttpResponse = {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: new Uint8Array([1, 2, 3, 4]),
      }
      transport.enqueueChunkedResponse(chunkedResponse)
      const controller = new AbortController()
      const streamResult = await transport.stream(request, controller.signal)
      // When
      controller.abort()
      const chunks: Uint8Array[] = []
      // Then
      await expect(
        (async () => {
          for await (const chunk of streamResult.body) {
            chunks.push(chunk)
          }
        })(),
      ).rejects.toBeInstanceOf(OperationCancelledError)
    })
  })
})
