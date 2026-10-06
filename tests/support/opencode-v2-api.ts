import { z } from "zod"

import type { OpenCodeV2Process } from "./opencode-v2-process"

const pluginSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("builtin") }),
  z.object({ type: z.literal("local"), path: z.string() }),
  z.object({ type: z.literal("package"), target: z.string() }),
  z.object({ type: z.literal("sdk") }),
])

const pluginSchema = z
  .object({
    id: z.string().optional(),
    source: pluginSourceSchema,
    features: z.object({ tui: z.literal(true).optional() }),
    state: z.discriminatedUnion("status", [
      z.object({ status: z.literal("active") }),
      z.object({ status: z.literal("failed"), error: z.string() }),
    ]),
  })
  .transform((plugin) => ({
    id: plugin.id,
    source: plugin.source,
    status: plugin.state.status,
    tui: plugin.features.tui === true,
    error: plugin.state.status === "failed" ? plugin.state.error : undefined,
  }))

const providerSchema = z.object({
  id: z.string(),
  name: z.string(),
  activation: z.enum(["auto", "enabled", "disabled"]),
  package: z.string(),
  integrationID: z.string().optional(),
})

const modelSchema = z.object({
  id: z.string(),
  modelID: z.string(),
  providerID: z.string(),
  name: z.string(),
  enabled: z.boolean(),
})

const connectionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("credential"),
    id: z.string(),
    label: z.string(),
    method: z.enum(["key", "oauth"]),
  }),
  z.object({ type: z.literal("env"), name: z.string() }),
])

const integrationSchema = z.object({
  id: z.string(),
  name: z.string(),
  connections: z.array(connectionSchema),
})

const generateSchema = z.object({
  data: z.object({ text: z.string() }),
})

const located = <T extends z.ZodType>(data: T) =>
  z.object({
    location: z.object({ directory: z.string() }),
    data,
  })

export const pluginListSchema = located(z.array(pluginSchema))
export const providerListSchema = located(z.array(providerSchema))
export const modelListSchema = located(z.array(modelSchema))
export const integrationListSchema = located(z.array(integrationSchema))
export const generateTextSchema = generateSchema

export type V2PluginInfo = z.infer<typeof pluginSchema>
export type V2ProviderInfo = z.infer<typeof providerSchema>
export type V2ModelInfo = z.infer<typeof modelSchema>
export type V2IntegrationInfo = z.infer<typeof integrationSchema>

export class OpenCodeV2PluginFailedError extends Error {
  public override readonly name = "OpenCodeV2PluginFailedError"

  public constructor(public readonly plugin: V2PluginInfo) {
    super(
      `OpenCode V2 plugin ${plugin.id ?? JSON.stringify(plugin.source)} failed: ${plugin.error}`,
    )
  }
}

export class OpenCodeV2ApiError extends Error {
  public override readonly name = "OpenCodeV2ApiError"

  public constructor(
    public readonly path: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`OpenCode V2 ${path} failed with status ${status}`)
  }
}

export class OpenCodeV2WaitError extends Error {
  public override readonly name = "OpenCodeV2WaitError"

  public constructor(
    public readonly label: string,
    public readonly timeoutMs: number,
  ) {
    super(`OpenCode V2 ${label} was not ready within ${timeoutMs}ms`)
  }
}

export type OpenCodeV2Endpoint = {
  readonly directory: string
  readonly password: string
  readonly url: string
}

type JsonRequest = {
  readonly body?: unknown
  readonly endpoint: OpenCodeV2Endpoint
  readonly method: "GET" | "POST"
  readonly path: string
}

function authorization(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`, "utf8").toString("base64")}`
}

function locatedUrl(endpoint: OpenCodeV2Endpoint, path: string): URL {
  const url = new URL(path, endpoint.url)
  url.searchParams.set("location[directory]", endpoint.directory)
  return url
}

export function endpointFrom(session: {
  readonly directory: string
  readonly server: Pick<OpenCodeV2Process, "password" | "url">
}): OpenCodeV2Endpoint {
  return {
    directory: session.directory,
    password: session.server.password,
    url: session.server.url,
  }
}

export async function requestV2(input: JsonRequest): Promise<unknown> {
  const response = await fetch(locatedUrl(input.endpoint, input.path), {
    method: input.method,
    headers: {
      authorization: authorization(input.endpoint.password),
      ...(input.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status === 204) return undefined
  const body = await response.text()
  if (!response.ok) throw new OpenCodeV2ApiError(input.path, response.status, body)
  if (body.length === 0) return undefined
  return readJson(body)
}

function readJson(body: string): unknown {
  return JSON.parse(body)
}

export async function listPlugins(endpoint: OpenCodeV2Endpoint): Promise<readonly V2PluginInfo[]> {
  const plugins = pluginListSchema.parse(
    await requestV2({ endpoint, method: "GET", path: "/api/plugin" }),
  ).data
  const failed = plugins.find((plugin) => plugin.status === "failed")
  if (failed !== undefined) throw new OpenCodeV2PluginFailedError(failed)
  return plugins
}

export async function listProviders(
  endpoint: OpenCodeV2Endpoint,
): Promise<readonly V2ProviderInfo[]> {
  return providerListSchema.parse(
    await requestV2({ endpoint, method: "GET", path: "/api/provider" }),
  ).data
}

export async function listModels(endpoint: OpenCodeV2Endpoint): Promise<readonly V2ModelInfo[]> {
  return modelListSchema.parse(await requestV2({ endpoint, method: "GET", path: "/api/model" }))
    .data
}

export async function listIntegrations(
  endpoint: OpenCodeV2Endpoint,
): Promise<readonly V2IntegrationInfo[]> {
  return integrationListSchema.parse(
    await requestV2({ endpoint, method: "GET", path: "/api/integration" }),
  ).data
}

export async function connectIntegrationKey(input: {
  readonly endpoint: OpenCodeV2Endpoint
  readonly integrationID: string
  readonly key: string
}): Promise<void> {
  await requestV2({
    endpoint: input.endpoint,
    method: "POST",
    path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/key`,
    body: { key: input.key },
  })
}

export async function generateText(input: {
  readonly endpoint: OpenCodeV2Endpoint
  readonly modelID: string
  readonly prompt: string
  readonly providerID: string
}): Promise<string> {
  const body = await requestV2({
    endpoint: input.endpoint,
    method: "POST",
    path: "/api/experimental/generate",
    body: {
      prompt: input.prompt,
      model: { id: input.modelID, providerID: input.providerID },
    },
  })
  return generateTextSchema.parse(body).data.text
}

export async function readUntil<T>(input: {
  readonly label: string
  readonly read: () => Promise<T>
  readonly ready: (value: T) => boolean
  readonly timeoutMs: number
}): Promise<T> {
  const deadline = Date.now() + input.timeoutMs
  let latest = await input.read()
  while (!input.ready(latest)) {
    if (Date.now() >= deadline) throw new OpenCodeV2WaitError(input.label, input.timeoutMs)
    await Bun.sleep(50)
    latest = await input.read()
  }
  return latest
}
