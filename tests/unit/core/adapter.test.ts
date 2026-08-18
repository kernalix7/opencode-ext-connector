import { describe, expect, it } from "bun:test"

import {
  type CatalogPublisher,
  type ProviderAdapter,
  refreshProviderCatalog,
} from "../../../src/core/adapter"
import { AdapterError, OperationCancelledError } from "../../../src/core/errors"
import { parseProviderId } from "../../../src/core/ids"
import type { ProviderSnapshot } from "../../../src/core/models"

function adapterFor(snapshot: ProviderSnapshot): ProviderAdapter {
  return {
    providerId: parseProviderId("provider-one"),
    snapshot: async (_signal): Promise<ProviderSnapshot> => snapshot,
    dispose: async (): Promise<void> => undefined,
    [Symbol.asyncDispose]: async (): Promise<void> => undefined,
  }
}

describe("refreshProviderCatalog", () => {
  it("publishes and returns the adapter snapshot", async () => {
    // Given
    const snapshot: ProviderSnapshot = {
      status: "ready",
      providerId: parseProviderId("provider-one"),
      models: [],
    }
    const published: ProviderSnapshot[] = []
    const publisher: CatalogPublisher = { publish: async (value) => void published.push(value) }
    const signal = new AbortController().signal
    // When
    const result = await refreshProviderCatalog({
      adapter: adapterFor(snapshot),
      publisher,
      signal,
    })
    // Then
    expect(result).toBe(snapshot)
    expect(published).toEqual([snapshot])
  })

  it("rejects a pre-cancelled refresh before collaborators run", async () => {
    // Given
    const controller = new AbortController()
    controller.abort()
    const snapshot: ProviderSnapshot = {
      status: "unavailable",
      providerId: parseProviderId("provider-one"),
      reason: "adapter-error",
    }
    let published = false
    const publisher: CatalogPublisher = {
      publish: async () => {
        published = true
      },
    }
    // When
    const promise = refreshProviderCatalog({
      adapter: adapterFor(snapshot),
      publisher,
      signal: controller.signal,
    })
    // Then
    await expect(promise).rejects.toBeInstanceOf(OperationCancelledError)
    expect(published).toBe(false)
  })

  it("rejects provider identity mismatches without publication", async () => {
    // Given
    const snapshot: ProviderSnapshot = {
      status: "ready",
      providerId: parseProviderId("provider-two"),
      models: [],
    }
    let published = false
    const publisher: CatalogPublisher = {
      publish: async () => {
        published = true
      },
    }
    // When
    const promise = refreshProviderCatalog({
      adapter: adapterFor(snapshot),
      publisher,
      signal: new AbortController().signal,
    })
    // Then
    await expect(promise).rejects.toBeInstanceOf(AdapterError)
    expect(published).toBe(false)
  })
})
