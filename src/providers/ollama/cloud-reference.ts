import { createHash } from "node:crypto"
import { z } from "zod"

import type { AdapterModel } from "../../core/models.js"
import { parseAdapterModel } from "../../core/models.js"
import { OllamaCatalogError } from "./errors.js"
import { type OllamaFetch, requestOllamaCatalogBytes } from "./http.js"

export type HostedCloudId = string & z.$brand<"HostedCloudId">
export const HostedCloudIdSchema: z.core.$ZodBranded<z.ZodString, "HostedCloudId"> = z
  .string()
  .max(256)
  .regex(/^[a-z0-9][a-z0-9._-]*(?::[A-Za-z0-9][A-Za-z0-9._-]*)?$/)
  .brand<"HostedCloudId">()
const ManifestSchema = z.object({
  schemaVersion: z.literal(2),
  mediaType: z.literal("application/vnd.docker.distribution.manifest.v2+json"),
  config: z.object({
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    size: z
      .number()
      .int()
      .positive()
      .max(16 * 1024),
  }),
  layers: z.array(z.unknown()).length(0),
})
const ConfigSchema = z.object({
  remote_host: z.literal("https://ollama.com"),
  remote_model: HostedCloudIdSchema,
})

export type OllamaCloudReference = {
  readonly model: AdapterModel
  readonly hostedId: HostedCloudId
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new OllamaCatalogError("cloud-family", "invalid-data")
    }
    throw error
  }
}

export async function verifyCloudReference(
  reference: OllamaCloudReference,
  fetch: OllamaFetch,
  signal: AbortSignal,
): Promise<boolean> {
  const [family, tag] = reference.model.id.split(":")
  const base = `https://registry.ollama.ai/v2/library/${family}`
  const manifestBytes = await requestOllamaCatalogBytes({
    url: `${base}/manifests/${tag}`,
    accept: "application/vnd.docker.distribution.manifest.v2+json",
    operation: "cloud-family",
    fetch,
    signal,
    maximumBytes: 16 * 1024,
    allowMissing: true,
  })
  if (manifestBytes === null) return false
  const manifest = ManifestSchema.safeParse(parseJson(manifestBytes))
  if (!manifest.success) throw new OllamaCatalogError("cloud-family", "invalid-data")
  const bytes = await requestOllamaCatalogBytes({
    url: `${base}/blobs/${manifest.data.config.digest}`,
    accept: "application/json",
    operation: "cloud-family",
    fetch,
    signal,
    maximumBytes: 16 * 1024,
  })
  if (
    bytes === null ||
    bytes.byteLength !== manifest.data.config.size ||
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== manifest.data.config.digest
  ) {
    throw new OllamaCatalogError("cloud-family", "invalid-data")
  }
  const config = ConfigSchema.safeParse(parseJson(bytes))
  if (!config.success) throw new OllamaCatalogError("cloud-family", "invalid-data")
  return config.data.remote_model === reference.hostedId
}

export async function resolveCloudReference(
  hostedId: z.infer<typeof HostedCloudIdSchema>,
  fetch: OllamaFetch,
  signal: AbortSignal,
): Promise<AdapterModel> {
  const [family, variant] = hostedId.split(":")
  // These are bounded discovery candidates, never pull authorization.
  const candidates =
    variant === undefined ? ["cloud", "latest-cloud"] : [`${variant}-cloud`, "cloud"]
  for (const tag of candidates) {
    const model = parseAdapterModel({ id: `${family}:${tag}` })
    if (await verifyCloudReference({ model, hostedId }, fetch, signal)) return model
  }
  throw new OllamaCatalogError("cloud-family", "invalid-data")
}
