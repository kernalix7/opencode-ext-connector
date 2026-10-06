import type { LanguageModelV3 } from "@ai-sdk/provider"

import type {
  PluginV2ConnectionInfo,
  PluginV2IntegrationEditor,
  PluginV2IntegrationMethodRegistration,
  PluginV2ProviderEditor,
  PluginV2Registration,
} from "../../../src/opencode/beta-api"
import { ModelV2, ProviderV2 } from "../../../src/opencode/beta-api"
import type { V2ModelHookInput } from "../../../src/opencode/v2-language"
import type { V2HostContext } from "../../../src/opencode/v2-setup"

type ProviderRecord = ReturnType<PluginV2ProviderEditor["list"]>[number]
type HookName = "sdk" | "language"

export type V2HookCall = {
  readonly name: HookName
  readonly providerID: string | undefined
  readonly invoke: (input: {
    readonly packageName?: string
    readonly modelPackage?: string
    readonly providerID: string
    readonly modelID: string
  }) => { readonly sdk: unknown; readonly language: LanguageModelV3 | undefined }
}

export type V2Host = V2HostContext & {
  readonly hooks: readonly V2HookCall[]
  readonly methods: readonly PluginV2IntegrationMethodRegistration[]
  readonly providers: () => readonly ProviderRecord[]
  readonly reloadCount: () => number
  readonly emit: (type: string) => void
  setConnection(integrationID: string, connection: PluginV2ConnectionInfo | undefined): void
  setKey(integrationID: string, key: string): void
  failActive(error: Error): void
}

type StoredProvider = {
  provider: ProviderRecord["provider"]
  models: Map<
    string,
    ProviderRecord["models"] extends ReadonlyMap<string, infer Model> ? Model : never
  >
  sourceConnection?: PluginV2ConnectionInfo
}

function eventFor(type: string): { readonly type: string } {
  return { type }
}

export function createV2Host(
  options: { readonly pluginOptions?: unknown; readonly reloadEmits?: boolean } = {},
): V2Host {
  const connections = new Map<string, PluginV2ConnectionInfo>()
  const keys = new Map<string, string>()
  let activeError: Error | undefined
  let reloadCount = 0
  let applyProviders: ((editor: PluginV2ProviderEditor) => void) | undefined
  const stored = new Map<string, StoredProvider>()
  const methods: PluginV2IntegrationMethodRegistration[] = []
  const hooks: V2HookCall[] = []
  const pending: Array<{ readonly type: string }> = []
  let wake: (() => void) | undefined

  const editor: PluginV2ProviderEditor = {
    list: () =>
      [...stored.values()].map((record) => ({
        provider: record.provider,
        models: record.models,
        ...(record.sourceConnection === undefined
          ? {}
          : { sourceConnection: record.sourceConnection }),
      })),
    get: (providerID) => editor.list().find((record) => record.provider.id === providerID),
    add: (input) => {
      stored.set(input.info.id, {
        provider: input.info,
        models: new Map(input.models.map((model) => [model.id, model])),
        ...(input.sourceConnection === undefined
          ? {}
          : { sourceConnection: input.sourceConnection }),
      })
    },
    update: () => undefined,
    remove: (providerID) => {
      stored.delete(providerID)
    },
    models: {
      set: (providerID, models) => {
        const record = stored.get(providerID)
        if (record === undefined) return
        record.models = new Map(models.map((model) => [model.id, model]))
      },
      update: () => undefined,
      remove: (providerID, modelID) => {
        stored.get(providerID)?.models.delete(modelID)
      },
    },
  }

  const integrationEditor: PluginV2IntegrationEditor = {
    list: () => methods.map((method) => ({ id: method.integrationID, name: method.integrationID })),
    get: (id) => integrationEditor.list().find((item) => item.id === id),
    update: () => undefined,
    remove: (id) => {
      for (let index = methods.length - 1; index >= 0; index -= 1) {
        if (methods[index]?.integrationID === id) methods.splice(index, 1)
      }
    },
    method: {
      list: (integrationID) =>
        methods.flatMap((method) =>
          method.integrationID === integrationID ? [method.method] : [],
        ),
      update: (input) => {
        methods.push(input)
      },
      remove: () => undefined,
    },
  }

  const emit = (type: string): void => {
    pending.push(eventFor(type))
    wake?.()
    wake = undefined
  }

  return {
    options: options.pluginOptions ?? {},
    hooks,
    methods,
    providers: () => editor.list(),
    reloadCount: () => reloadCount,
    emit,
    setConnection: (integrationID, connection) => {
      if (connection === undefined) connections.delete(integrationID)
      else connections.set(integrationID, connection)
    },
    setKey: (integrationID, key) => {
      keys.set(integrationID, key)
    },
    failActive: (error) => {
      activeError = error
    },
    integration: {
      transform: async (callback) => {
        callback(integrationEditor)
        return { dispose: async () => undefined }
      },
      connection: {
        active: async (integrationID) => {
          if (activeError !== undefined) throw activeError
          return connections.get(integrationID)
        },
        resolve: async (connection) => {
          if (connection.type !== "credential") return undefined
          const key = keys.get(connection.id) ?? keys.get(connection.label)
          if (key === undefined) return undefined
          return { type: "key", key }
        },
        status: async () => undefined,
      },
    },
    provider: {
      transform: async (callback) => {
        applyProviders = callback
        callback(editor)
        const registration: PluginV2Registration = {
          dispose: async () => {
            applyProviders = undefined
          },
        }
        return registration
      },
      reload: async () => {
        reloadCount += 1
        applyProviders?.(editor)
        if (options.reloadEmits === true) emit("integration.updated")
      },
    },
    aisdk: {
      hook: async (name, callback, hookOptions) => {
        hooks.push({
          name,
          providerID: hookOptions?.providerID,
          invoke: (input) => {
            const model = {
              ...ModelV2.Info.default(
                ProviderV2.ID.make(input.providerID),
                ModelV2.ID.make(input.modelID),
              ),
              ...(input.modelPackage === undefined ? {} : { package: input.modelPackage }),
            }
            const evt: V2ModelHookInput =
              name === "sdk" ? { model, package: input.packageName ?? "" } : { model }
            callback(evt)
            return { sdk: evt.sdk, language: evt.language }
          },
        })
        return { dispose: async () => undefined }
      },
    },
    event: {
      subscribe: async function* (subscribeOptions) {
        const signal = subscribeOptions?.signal ?? new AbortController().signal
        while (!signal.aborted) {
          const next = pending.shift()
          if (next !== undefined) {
            yield next
            continue
          }
          await new Promise<void>((resolve) => {
            if (signal.aborted) {
              resolve()
              return
            }
            const finish = (): void => {
              signal.removeEventListener("abort", finish)
              resolve()
            }
            signal.addEventListener("abort", finish, { once: true })
            wake = finish
          })
        }
      },
    },
  }
}

export function credentialConnection(id: string, method: "key" | "oauth"): PluginV2ConnectionInfo {
  return { type: "credential", id, label: id, method }
}

export function envConnection(name: string): PluginV2ConnectionInfo {
  return { type: "env", name }
}

export async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}
