import { describe, expect, it } from "bun:test"

import {
  AdapterError,
  ConnectorError,
  DeadlineExceededError,
  HttpTransportError,
  InvalidArgumentError,
  OperationCancelledError,
  ProcessSupervisorError,
  ResourceDisposedError,
} from "../../../src/core/errors"
import { parseProviderId } from "../../../src/core/ids"

describe("connector errors", () => {
  it("exposes stable codes and typed context", () => {
    // Given
    const errors = [
      new InvalidArgumentError("timeout"),
      new OperationCancelledError("refresh"),
      new DeadlineExceededError(10),
      new ResourceDisposedError("adapter"),
      new AdapterError({
        operation: "snapshot",
        retryable: true,
        cause: null,
        providerId: parseProviderId("one"),
      }),
      new HttpTransportError({ operation: "request", retryable: true, cause: null }),
      new ProcessSupervisorError({ operation: "start", retryable: false, cause: null }),
    ]
    // When
    const codes = errors.map((error) => error.code)
    // Then
    expect(codes).toEqual([
      "invalid-argument",
      "operation-cancelled",
      "deadline-exceeded",
      "resource-disposed",
      "adapter-error",
      "http-transport-error",
      "process-supervisor-error",
    ])
    expect(errors.every((error) => error instanceof ConnectorError)).toBe(true)
  })

  it("preserves infrastructure causes", () => {
    // Given
    const cause = new TypeError("failure")
    // When
    const error = new HttpTransportError({ operation: "request", retryable: true, cause })
    // Then
    expect(error.cause).toBe(cause)
  })
})
