import { describe, expect, it } from "bun:test"
import {
  type AISDKHooks,
  type CatalogDraft,
  type CatalogHooks,
  type CatalogProviderRecord,
  CredentialV2,
  define,
  ModelV2,
  type Plugin,
  type PluginContext,
  PluginV2,
  type PluginV2ConnectionInfo,
  type PluginV2Context,
  type PluginV2IntegrationEditor,
  type PluginV2IntegrationMethodRegistration,
  type PluginV2ProviderEditor,
  type PluginV2Registration,
  ProviderV2,
  type Registration,
} from "../../../src/opencode/beta-api"

function useType<T>(_value: T | undefined): void {}

describe("opencode beta-api re-exports", () => {
  it("define returns the same object identity", () => {
    // Given
    const plugin = {
      id: "opencode-ext-connector",
      setup: (_ctx: PluginContext) => {},
    } satisfies Plugin

    // When
    const result = define(plugin)

    // Then
    expect(result).toBe(plugin)
  })

  it("exported define is a function and Plugin type is usable without importing /v2", () => {
    // Given
    const plugin: Plugin = {
      id: "test-plugin",
      setup: (_ctx: PluginContext) => {},
    }

    // When
    const isFunction = typeof define === "function"

    // Then
    expect(isFunction).toBe(true)
    expect(plugin.id).toBe("test-plugin")
  })

  it("re-exports all required types", () => {
    useType<PluginContext>(undefined)
    useType<Registration>(undefined)
    useType<CatalogDraft>(undefined)
    useType<CatalogProviderRecord>(undefined)
    useType<AISDKHooks>(undefined)
    useType<CatalogHooks>(undefined)
    expect(true).toBe(true)
  })

  it("re-exports V2 namespaces without replacing the legacy define export", () => {
    // Given
    const plugin = {
      id: "opencode-ext-connector",
      setup: (_ctx: PluginV2Context) => {},
    }

    // When
    const defined = PluginV2.define(plugin)

    // Then
    expect(defined).toBe(plugin)
    expect(define).not.toBe(PluginV2.define)
    expect(typeof ProviderV2.ID.make).toBe("function")
    expect(typeof ModelV2.ID.make).toBe("function")
    expect(typeof CredentialV2.ID.make).toBe("function")
    useType<PluginV2ProviderEditor>(undefined)
    useType<PluginV2IntegrationEditor>(undefined)
    useType<PluginV2IntegrationMethodRegistration>(undefined)
    useType<PluginV2ConnectionInfo>(undefined)
    useType<PluginV2Registration>(undefined)
  })
})
