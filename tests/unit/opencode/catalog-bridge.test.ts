import { describe, expect, it } from "bun:test"
import { OperationCancelledError } from "../../../src/core/errors"
import { parseModelId, parseProviderId } from "../../../src/core/ids"
import { createCatalogPublisher } from "../../../src/opencode/catalog-bridge"
import { MemoryCatalogDraft } from "../../support/catalog"

describe("createCatalogPublisher", () => {
  it("publishes ready models onto the catalog draft", async () => {
    // Given
    const draft = new MemoryCatalogDraft()
    const publisher = createCatalogPublisher(draft)
    const providerId = parseProviderId("provider-one")
    const modelId = parseModelId("model-a")
    // When
    await publisher.publish(
      { status: "ready", providerId, models: [{ id: modelId }] },
      new AbortController().signal,
    )
    // Then
    const record = draft.provider.get(providerId)
    expect(record?.provider.disabled).toBe(false)
    expect(record?.models.get(modelId)?.id).toBe(modelId)
    expect(record?.models.get(modelId)?.enabled).toBe(true)
  })

  it("keeps stale models on the catalog draft", async () => {
    // Given
    const draft = new MemoryCatalogDraft()
    const publisher = createCatalogPublisher(draft)
    const providerId = parseProviderId("provider-one")
    const modelId = parseModelId("model-a")
    // When
    await publisher.publish(
      {
        status: "stale",
        providerId,
        models: [{ id: modelId }],
        reason: "transport-error",
      },
      new AbortController().signal,
    )
    // Then
    expect(draft.provider.get(providerId)?.models.has(modelId)).toBe(true)
  })

  it("removes an unavailable provider", async () => {
    // Given
    const draft = new MemoryCatalogDraft()
    const publisher = createCatalogPublisher(draft)
    const providerId = parseProviderId("provider-one")
    await publisher.publish(
      { status: "ready", providerId, models: [{ id: parseModelId("model-a") }] },
      new AbortController().signal,
    )
    // When
    await publisher.publish(
      { status: "unavailable", providerId, reason: "adapter-error" },
      new AbortController().signal,
    )
    // Then
    expect(draft.provider.get(providerId)).toBeUndefined()
  })

  it("rejects a pre-cancelled publish", async () => {
    // Given
    const draft = new MemoryCatalogDraft()
    const publisher = createCatalogPublisher(draft)
    const controller = new AbortController()
    controller.abort()
    // When
    const promise = publisher.publish(
      {
        status: "ready",
        providerId: parseProviderId("provider-one"),
        models: [],
      },
      controller.signal,
    )
    // Then
    await expect(promise).rejects.toBeInstanceOf(OperationCancelledError)
    expect(draft.provider.list()).toEqual([])
  })
})
