import { createHash } from "node:crypto"

export const fixtureCloudModelName = "fixture-family:cloud"
const config = JSON.stringify({
  remote_host: "https://ollama.com",
  remote_model: "fixture-family",
})
const digest = `sha256:${createHash("sha256").update(config).digest("hex")}`
const registryBase = "https://registry.ollama.ai/v2/library/fixture-family"

export const cloudDiscoveryResponses: Readonly<Record<string, string>> = {
  "https://ollama.com/api/tags": JSON.stringify({ models: [{ name: "fixture-family" }] }),
  [`${registryBase}/manifests/cloud`]: JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.docker.distribution.manifest.v2+json",
    config: { digest, size: Buffer.byteLength(config) },
    layers: [],
  }),
  [`${registryBase}/blobs/${digest}`]: config,
}
