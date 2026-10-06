import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"

import {
  HostedCloudIdSchema,
  resolveCloudReference,
} from "../../../../src/providers/ollama/cloud-reference"
import { OllamaCatalogError } from "../../../../src/providers/ollama/errors"
import { FakeFetch, jsonResponse } from "./http-fake"

const BASE = "https://registry.ollama.ai/v2/library/gpt-oss"
const SIGNAL = new AbortController().signal

function enqueueReference(http: FakeFetch, config: object, layers: readonly object[] = []): string {
  const bytes = JSON.stringify(config)
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`
  http.enqueue(
    `${BASE}/manifests/120b-cloud`,
    jsonResponse({
      schemaVersion: 2,
      mediaType: "application/vnd.docker.distribution.manifest.v2+json",
      config: { digest, size: Buffer.byteLength(bytes) },
      layers,
    }),
  )
  http.enqueue(`${BASE}/blobs/${digest}`, new Response(bytes))
  return digest
}

describe("verified Cloud references", () => {
  it("verifies the publicly observed 307-byte gpt-oss config without requiring a JSON content type", async () => {
    // Given
    const http = new FakeFetch()
    const digest = "sha256:dad8bd034e571c7856a11969a6a9d59a0b8a10a13a39b9f5899b308165d6ddb7"
    const bytes =
      '{"architecture":"amd64","base_name":"gpt-oss:120b","capabilities":["completion","tools","thinking"],"context_length":131072,"embedding_length":2880,"file_type":"MXFP4","model_type":"117B","os":"linux","remote_host":"https://ollama.com","remote_model":"gpt-oss:120b","rootfs":{"diff_ids":[],"type":"layers"}}'
    http.enqueue(
      `${BASE}/manifests/120b-cloud`,
      jsonResponse({
        schemaVersion: 2,
        mediaType: "application/vnd.docker.distribution.manifest.v2+json",
        config: { digest, size: 307 },
        layers: [],
      }),
    )
    http.enqueue(
      `${BASE}/blobs/${digest}`,
      new Response(bytes, {
        headers: {
          "content-type": "application/octet-stream",
          location: `${BASE}/blobs/${digest}`,
        },
      }),
    )
    // When
    const model = await resolveCloudReference(
      HostedCloudIdSchema.parse("gpt-oss:120b"),
      http.fetch,
      SIGNAL,
    )
    // Then
    expect(String(model.id)).toBe("gpt-oss:120b-cloud")
  })
  it("returns the exact daemon reference when its config matches the hosted ID", async () => {
    // Given
    const http = new FakeFetch()
    const digest = enqueueReference(http, {
      remote_host: "https://ollama.com",
      remote_model: "gpt-oss:120b",
    })
    // When
    const model = await resolveCloudReference(
      HostedCloudIdSchema.parse("gpt-oss:120b"),
      http.fetch,
      SIGNAL,
    )
    // Then
    expect(String(model.id)).toBe("gpt-oss:120b-cloud")
    expect(http.requests.map(({ url }) => url)).toEqual([
      `${BASE}/manifests/120b-cloud`,
      `${BASE}/blobs/${digest}`,
    ])
    expect(http.requests.map(({ init }) => new Headers(init?.headers).get("accept"))).toEqual([
      "application/vnd.docker.distribution.manifest.v2+json",
      "application/json",
    ])
    expect(
      http.requests.every(
        ({ url, init }) =>
          url.startsWith(`${BASE}/`) &&
          init?.method === "GET" &&
          init.credentials === "omit" &&
          init.redirect === "error" &&
          new Headers(init.headers).get("authorization") === null,
      ),
    ).toBe(true)
  })

  for (const host of [
    "https://evil.test",
    "https://ollama.com?token=x",
    "https://user@ollama.com",
    "http://ollama.com",
    "https://ollama.com/#x",
  ]) {
    it(`rejects remote host ${host} when it is not the exact official HTTPS origin`, async () => {
      // Given
      const http = new FakeFetch()
      enqueueReference(http, { remote_host: host, remote_model: "gpt-oss:120b" })
      // When
      const promise = resolveCloudReference(
        HostedCloudIdSchema.parse("gpt-oss:120b"),
        http.fetch,
        SIGNAL,
      )
      // Then
      await expect(promise).rejects.toBeInstanceOf(OllamaCatalogError)
    })
  }

  it("rejects a variant alias when neither candidate matches the exact hosted ID", async () => {
    // Given
    const http = new FakeFetch()
    enqueueReference(http, { remote_host: "https://ollama.com", remote_model: "gpt-oss:20b" })
    http.enqueue(`${BASE}/manifests/cloud`, jsonResponse({}, 404))
    // When
    const promise = resolveCloudReference(
      HostedCloudIdSchema.parse("gpt-oss:120b"),
      http.fetch,
      SIGNAL,
    )
    // Then
    await expect(promise).rejects.toBeInstanceOf(OllamaCatalogError)
  })

  it("rejects weight-bearing manifests before requesting any blob", async () => {
    // Given
    const http = new FakeFetch()
    enqueueReference(http, { remote_host: "https://ollama.com", remote_model: "gpt-oss:120b" }, [
      { size: 9000000 },
    ])
    // When
    const promise = resolveCloudReference(
      HostedCloudIdSchema.parse("gpt-oss:120b"),
      http.fetch,
      SIGNAL,
    )
    // Then
    await expect(promise).rejects.toBeInstanceOf(OllamaCatalogError)
    expect(http.requests).toHaveLength(1)
  })

  it("rejects tampered config bytes even when the size matches", async () => {
    // Given
    const http = new FakeFetch()
    const digest = `sha256:${"0".repeat(64)}`
    http.enqueue(
      `${BASE}/manifests/120b-cloud`,
      jsonResponse({
        schemaVersion: 2,
        mediaType: "application/vnd.docker.distribution.manifest.v2+json",
        config: { digest, size: 2 },
        layers: [],
      }),
    )
    http.enqueue(`${BASE}/blobs/${digest}`, new Response("{}"))
    // When
    const promise = resolveCloudReference(
      HostedCloudIdSchema.parse("gpt-oss:120b"),
      http.fetch,
      SIGNAL,
    )
    // Then
    await expect(promise).rejects.toBeInstanceOf(OllamaCatalogError)
  })

  it("fails discovery when all bounded candidates return 404", async () => {
    // Given
    const http = new FakeFetch()
    for (const tag of ["120b-cloud", "cloud"])
      http.enqueue(`${BASE}/manifests/${tag}`, jsonResponse({}, 404))
    // When
    const promise = resolveCloudReference(
      HostedCloudIdSchema.parse("gpt-oss:120b"),
      http.fetch,
      SIGNAL,
    )
    // Then
    await expect(promise).rejects.toBeInstanceOf(OllamaCatalogError)
    expect(http.requests.map(({ url }) => url)).toEqual([
      `${BASE}/manifests/120b-cloud`,
      `${BASE}/manifests/cloud`,
    ])
  })

  it("rejects config bytes when their digest matches but their declared size differs", async () => {
    // Given
    const http = new FakeFetch()
    const bytes = JSON.stringify({
      remote_host: "https://ollama.com",
      remote_model: "gpt-oss:120b",
    })
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`
    http.enqueue(
      `${BASE}/manifests/120b-cloud`,
      jsonResponse({
        schemaVersion: 2,
        mediaType: "application/vnd.docker.distribution.manifest.v2+json",
        config: { digest, size: Buffer.byteLength(bytes) + 1 },
        layers: [],
      }),
    )
    http.enqueue(`${BASE}/blobs/${digest}`, new Response(bytes))
    // When
    const promise = resolveCloudReference(
      HostedCloudIdSchema.parse("gpt-oss:120b"),
      http.fetch,
      SIGNAL,
    )
    // Then
    await expect(promise).rejects.toBeInstanceOf(OllamaCatalogError)
  })

  it("rejects a config redirect without following its location", async () => {
    // Given
    const http = new FakeFetch()
    const digest = `sha256:${"a".repeat(64)}`
    http.enqueue(
      `${BASE}/manifests/120b-cloud`,
      jsonResponse({
        schemaVersion: 2,
        mediaType: "application/vnd.docker.distribution.manifest.v2+json",
        config: { digest, size: 307 },
        layers: [],
      }),
    )
    http.enqueue(
      `${BASE}/blobs/${digest}`,
      new Response(null, { status: 307, headers: { location: "https://evil.test/blob" } }),
    )
    // When
    const promise = resolveCloudReference(
      HostedCloudIdSchema.parse("gpt-oss:120b"),
      http.fetch,
      SIGNAL,
    )
    // Then
    await expect(promise).rejects.toBeInstanceOf(OllamaCatalogError)
    expect(http.requests).toHaveLength(2)
  })
})
