import { describe, expect, it } from "bun:test"

import { ZodError } from "zod"
import { setupV2Connector } from "../../../src/opencode/v2-setup"
import { XaiV2ConsumerUnsupportedError } from "../../../src/opencode/v2-xai"
import { FakeProcessSupervisor, FakeSupervisedProcess } from "../../support/process"
import { createV2Host } from "./v2-host"

describe("V2 xAI mode selection", () => {
  for (const xaiOAuth of [undefined, { mode: "authority" }] as const) {
    it(`accepts ${xaiOAuth?.mode ?? "omission"} independently of the provider catalog`, async () => {
      // Given
      const host = createV2Host({ pluginOptions: { providers: [], xaiOAuth } })
      const supervisor = new FakeProcessSupervisor()
      supervisor.enqueueProcess(new FakeSupervisedProcess())
      // When
      const dispose = await setupV2Connector(host, {
        env: { HOME: "/home/test" },
        createXaiSupervisor: () => supervisor,
      })
      // Then
      expect(host.providers()).toHaveLength(0)
      await dispose()
    })
  }

  it("rejects V2 consumer before allocating or registering any host resources", async () => {
    // Given
    const host = createV2Host({ pluginOptions: { providers: [], xaiOAuth: { mode: "consumer" } } })
    const calls: string[] = []
    const connection = host.integration.connection
    const setup = setupV2Connector(
      {
        ...host,
        integration: {
          ...host.integration,
          connection: {
            ...connection,
            active: async (id) => {
              calls.push(`active:${id}`)
              return connection.active(id)
            },
            resolve: async (info) => {
              calls.push("resolve")
              return connection.resolve(info)
            },
          },
          transform: async (callback) => {
            calls.push("integration")
            return host.integration.transform(callback)
          },
        },
        provider: {
          ...host.provider,
          transform: async (callback) => {
            calls.push("provider")
            return host.provider.transform(callback)
          },
        },
        aisdk: {
          hook: async (name, callback, options) => {
            calls.push("sdk")
            return host.aisdk.hook(name, callback, options)
          },
        },
      },
      {
        createTransport: () => {
          calls.push("transport")
          throw new Error("unexpected transport")
        },
        createXaiSupervisor: () => {
          calls.push("supervisor")
          throw new Error("unexpected supervisor")
        },
      },
    )
    // When
    const error = await setup.catch((reason: unknown) => reason)
    // Then
    expect(error).toBeInstanceOf(XaiV2ConsumerUnsupportedError)
    if (!(error instanceof XaiV2ConsumerUnsupportedError)) throw error
    expect(error.code).toBe("XAI_V2_CONSUMER_UNSUPPORTED")
    expect(error.message).toContain("V1")
    expect(calls).toEqual([])
    expect(host.hooks).toHaveLength(0)
    expect(host.methods).toHaveLength(0)
  })

  for (const xaiOAuth of [null, {}, { mode: "invalid" }, { mode: "consumer", extra: true }]) {
    it("rejects malformed xAI mode before allocating runtime resources", async () => {
      // Given
      const host = createV2Host({ pluginOptions: { providers: [], xaiOAuth } })
      let allocated = false
      // When
      const setup = setupV2Connector(host, {
        createTransport: () => {
          allocated = true
          throw new Error("unexpected allocation")
        },
      })
      // Then
      await expect(setup).rejects.toBeInstanceOf(ZodError)
      expect(allocated).toBe(false)
    })
  }
})
