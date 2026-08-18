import { describe, expect, it } from "bun:test"
import {
  type AISDKHooks,
  type CatalogDraft,
  type CatalogHooks,
  type CatalogProviderRecord,
  define,
  type Plugin,
  type PluginContext,
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
})
