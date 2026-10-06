import { describe, expect, it } from "bun:test"

import { createConnectorLogger } from "../../../src/core/logger"
import type { PluginV2ConnectionInfo } from "../../../src/opencode/beta-api"
import {
  setupV2Connector,
  type V2HostContext,
  type V2SetupDependencies,
} from "../../../src/opencode/v2-setup"
import { FakeClock } from "../../support/clock"
import { FakeHttpTransport } from "../../support/http"
import { MemoryLogSink } from "../../support/log-sink"
import { createV2Host, credentialConnection, flushAsync } from "./v2-host"

function deps(transport: FakeHttpTransport, sink: MemoryLogSink): V2SetupDependencies {
  return {
    env: {},
    clock: new FakeClock(),
    createTransport: () => transport,
    createLogger: (clock) => createConnectorLogger(clock, sink),
  }
}

describe("V2 event refresh", () => {
  it("waits for an in-flight event refresh and retains its failure", async () => {
    // Given
    const host = createV2Host({
      pluginOptions: { providers: ["command-code"], catalogReloadMs: 0 },
    })
    host.setConnection("command-code", credentialConnection("command-code", "key"))
    host.setKey("command-code", "live-key")
    let deferActive = false
    let deferred = false
    let rejectGate: (error: Error) => void = () => undefined
    const gate = new Promise<PluginV2ConnectionInfo | undefined>((_resolve, reject) => {
      rejectGate = (error) => {
        reject(error)
      }
    })
    const context: V2HostContext = {
      ...host,
      integration: {
        transform: host.integration.transform,
        connection: {
          active: (integrationID) => {
            if (!deferActive) return host.integration.connection.active(integrationID)
            deferred = true
            return gate
          },
          resolve: host.integration.connection.resolve,
          status: host.integration.connection.status,
        },
      },
    }
    const sink = new MemoryLogSink()
    const failure = new TypeError("credential-secret-do-not-log")
    const cleanup = await setupV2Connector(context, deps(new FakeHttpTransport(), sink))
    deferActive = true
    host.emit("credential.updated")
    await flushAsync()
    expect(deferred).toBe(true)
    let settled = false
    const pending = cleanup().then(
      () => {
        settled = true
        return undefined
      },
      (caught: unknown) => {
        settled = true
        return caught
      },
    )

    // When
    await flushAsync()
    const waiting = settled
    rejectGate(failure)
    const error = await pending

    // Then
    expect(waiting).toBe(false)
    expect(error).toBe(failure)
    expect(sink.records.filter((record) => record.event === "v2.catalog.refresh-failed")).toEqual([
      expect.objectContaining({
        level: "warn",
        fields: { name: "TypeError" },
      }),
    ])
  })
})
