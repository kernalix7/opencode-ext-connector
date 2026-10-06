import { createHash } from "node:crypto"

import { type FakeFetch, jsonResponse } from "./http-fake"

export const CLOUD_TAGS_URL = "https://ollama.com/api/tags"

export function cloudManifestUrl(referenceId: string): string {
  const [family, tag] = referenceId.split(":")
  if (tag === undefined) throw new TypeError("fixture reference requires an exact tag")
  return `https://registry.ollama.ai/v2/library/${family}/manifests/${tag}`
}

export function enqueueCloudCatalog(http: FakeFetch, hostedIds: readonly string[]): void {
  http.enqueue(CLOUD_TAGS_URL, jsonResponse({ models: hostedIds.map((name) => ({ name })) }))
}

export function enqueueCloudReference(
  http: FakeFetch,
  reference: { readonly hostedId: string; readonly referenceId: string },
): void {
  const config = JSON.stringify({
    remote_host: "https://ollama.com",
    remote_model: reference.hostedId,
  })
  const bytes = new TextEncoder().encode(config)
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`
  const [family] = reference.referenceId.split(":")
  http.enqueue(
    cloudManifestUrl(reference.referenceId),
    jsonResponse({
      schemaVersion: 2,
      mediaType: "application/vnd.docker.distribution.manifest.v2+json",
      config: {
        mediaType: "application/vnd.docker.container.image.v1+json",
        digest,
        size: bytes.byteLength,
      },
      layers: [],
    }),
  )
  http.enqueue(
    `https://registry.ollama.ai/v2/library/${family}/blobs/${digest}`,
    new Response(bytes, { headers: { "content-type": "application/json" } }),
  )
}
