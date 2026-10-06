import { describe, expect, it } from "bun:test"

import {
  setupV2Connector,
  type V2HostContext,
  type V2SetupDependencies,
} from "../../../src/opencode/v2-setup"
import { FakeClock } from "../../support/clock"
import { FakeHttpTransport } from "../../support/http"
import { createV2Host, credentialConnection, flushAsync } from "./v2-host"

function deps(transport: FakeHttpTransport, clock = new FakeClock()): V2SetupDependencies {
  return {
    env: {},
    clock,
    createTransport: () => transport,
    createLogger: () => ({ log: () => undefined }),
  }
}
function catalog(transport: FakeHttpTransport, id = "qwen-test"): void {
  transport.enqueueResponse({
    status: 200,
    headers: {},
    body: new TextEncoder().encode(
      JSON.stringify({ data: [{ id, supported_endpoints: ["/provider/v1/chat/completions"] }] }),
    ),
  })
}
function connectedHost(interval = 0) {
  const host = createV2Host({
    pluginOptions: { providers: ["command-code"], catalogReloadMs: interval },
  })
  host.setConnection("command-code", credentialConnection("account-a", "key"))
  host.setKey("account-a", "fixture-key-a")
  return host
}

describe("official V2 lifecycle", () => {
  it("retains same-account catalog on a transient transport error", async () => {
    // Given
    const host = connectedHost()
    const transport = new FakeHttpTransport()
    catalog(transport)
    transport.enqueueError(new Error("fixture-transport-down"))
    const cleanup = await setupV2Connector(host, deps(transport))
    // When
    host.emit("integration.updated")
    await flushAsync()
    // Then
    expect([...(host.providers()[0]?.models.keys() ?? [])]).toEqual(["qwen-test"])
    await cleanup()
  })

  it("replaces the catalog and source connection after an account switch", async () => {
    // Given
    const host = connectedHost()
    const transport = new FakeHttpTransport()
    catalog(transport)
    catalog(transport, "next-model")
    const cleanup = await setupV2Connector(host, deps(transport))
    host.setConnection("command-code", credentialConnection("account-b", "key"))
    host.setKey("account-b", "fixture-key-b")
    // When
    host.emit("credential.switched")
    await flushAsync()
    // Then
    expect(host.providers()[0]?.sourceConnection).toEqual(credentialConnection("account-b", "key"))
    expect([...(host.providers()[0]?.models.keys() ?? [])]).toEqual(["next-model"])
    await cleanup()
  })

  it("does not reuse another account's models when its initial refresh fails", async () => {
    // Given
    const host = connectedHost()
    const transport = new FakeHttpTransport()
    catalog(transport)
    transport.enqueueError(new Error("fixture-transport-down"))
    const cleanup = await setupV2Connector(host, deps(transport))
    host.setConnection("command-code", credentialConnection("account-b", "key"))
    host.setKey("account-b", "fixture-key-b")
    // When
    host.emit("credential.switched")
    await flushAsync()
    // Then
    expect(host.providers()).toHaveLength(0)
    await cleanup()
  })

  it("does not recursively reload on its own integration event", async () => {
    // Given
    const host = createV2Host({ pluginOptions: { providers: ["command-code"] }, reloadEmits: true })
    host.setConnection("command-code", credentialConnection("account-a", "key"))
    host.setKey("account-a", "fixture-key-a")
    const transport = new FakeHttpTransport()
    catalog(transport)
    // When
    const cleanup = await setupV2Connector(host, deps(transport))
    await flushAsync()
    // Then
    expect(host.reloadCount()).toBeLessThan(5)
    await cleanup()
  })

  it("refreshes at the configured clock interval", async () => {
    // Given
    const clock = new FakeClock()
    const host = connectedHost(1_000)
    const transport = new FakeHttpTransport()
    catalog(transport)
    catalog(transport)
    const cleanup = await setupV2Connector(host, deps(transport, clock))
    // When
    clock.advanceBy(1_000)
    await flushAsync()
    // Then
    expect(transport.requests).toHaveLength(2)
    await cleanup()
  })

  it("runs other registrations' cleanup even if one fails", async () => {
    // Given
    const host = createV2Host({ pluginOptions: { providers: [] } })
    const failure = new TypeError("fixture-disposal")
    let providerDisposed = false
    const context: V2HostContext = {
      ...host,
      integration: {
        ...host.integration,
        transform: async (callback) => {
          await host.integration.transform(callback)
          return {
            dispose: () => {
              throw failure
            },
          }
        },
      },
      provider: {
        ...host.provider,
        transform: async (callback) => {
          await host.provider.transform(callback)
          return {
            dispose: async () => {
              providerDisposed = true
            },
          }
        },
      },
    }
    const cleanup = await setupV2Connector(context, deps(new FakeHttpTransport()))
    // When
    const result = cleanup()
    // Then
    await expect(result).rejects.toBe(failure)
    expect(providerDisposed).toBe(true)
  })

  it("releases an acquired registration if later setup fails", async () => {
    // Given
    const host = createV2Host({ pluginOptions: { providers: [] } })
    let disposed = false
    const failure = new TypeError("fixture-setup")
    const context: V2HostContext = {
      ...host,
      integration: {
        ...host.integration,
        transform: async (callback) => {
          await host.integration.transform(callback)
          return {
            dispose: async () => {
              disposed = true
            },
          }
        },
      },
      provider: {
        ...host.provider,
        transform: async () => {
          throw failure
        },
      },
    }
    // When
    const result = setupV2Connector(context, deps(new FakeHttpTransport()))
    // Then
    await expect(result).rejects.toBe(failure)
    expect(disposed).toBe(true)
  })

  it("shares the cleanup promise and releases each registration once", async () => {
    // Given
    const host = createV2Host({ pluginOptions: { providers: [] } })
    let disposals = 0
    const context: V2HostContext = {
      ...host,
      integration: {
        ...host.integration,
        transform: async (callback) => {
          await host.integration.transform(callback)
          return {
            dispose: async () => {
              disposals += 1
            },
          }
        },
      },
    }
    const cleanup = await setupV2Connector(context, deps(new FakeHttpTransport()))
    // When
    const first = cleanup()
    const second = cleanup()
    await first
    // Then
    expect(second).toBe(first)
    expect(disposals).toBe(1)
  })
})
