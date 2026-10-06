import { writeFile } from "node:fs/promises"
import net from "node:net"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { z } from "zod"
import { cloudDiscoveryResponses, fixtureCloudModelName } from "../support/cloud-discovery-fixture"
import type { PackedV2Plugin } from "../support/opencode-v2-packed"

export const ollamaModelName = "fixture-local:latest"
export const ollamaChatText = "fixture-token"
export const ollamaDaemonPrefix = "/fixture-daemon"
export const ollamaCloudModelName = fixtureCloudModelName

const cloudRequestSchema = z.object({
  url: z.url(),
  headers: z.record(z.string(), z.string()),
  credentials: z.string().optional(),
  method: z.string(),
  redirect: z.string(),
})
export type CloudRequest = z.infer<typeof cloudRequestSchema>

class EgressRecorderError extends Error {
  public override readonly name = "EgressRecorderError"
}

export type EgressRecorder = {
  readonly proxyUrl: string
  hosts(): readonly string[]
  stop(): Promise<void>
}

export type DaemonRequest = {
  readonly hasAuthorization: boolean
  readonly hasCookie: boolean
  readonly method: string
  readonly pathname: string
  readonly model: string | null
}

export type LoopbackDaemon = {
  readonly baseURL: string
  requests(): readonly DaemonRequest[]
  cloudRequests(): readonly CloudRequest[]
  stop(): Promise<void>
}

export function startEgressRecorder(): Promise<EgressRecorder> {
  const hosts: string[] = []
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    let pending = ""
    const onData = (chunk: Buffer): void => {
      pending += chunk.toString("utf8")
      if (!pending.includes("\r\n\r\n")) return
      socket.off("data", onData)
      hosts.push(pending.split("\r\n")[0] ?? "")
      socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
    }
    socket.on("data", onData)
  })
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (address === null || typeof address === "string") {
        reject(new EgressRecorderError("egress recorder did not bind a TCP port"))
        return
      }
      resolve({
        proxyUrl: `http://127.0.0.1:${address.port}`,
        hosts: () => hosts,
        stop: () => {
          for (const socket of sockets) socket.destroy()
          return new Promise((done, fail) => {
            server.close((error) => {
              if (error) fail(error)
              else done()
            })
          })
        },
      })
    })
  })
}

export function startLoopbackDaemon(): LoopbackDaemon {
  const requests: DaemonRequest[] = []
  const cloudRequests: CloudRequest[] = []
  let cloudPulled = false
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname === "/fixture-cloud") {
        const body: unknown = await request.json()
        cloudRequests.push(cloudRequestSchema.parse(body))
        return new Response(null, { status: 204 })
      }
      requests.push({
        hasAuthorization: request.headers.has("authorization"),
        hasCookie: request.headers.has("cookie"),
        method: request.method,
        pathname: url.pathname,
        model:
          request.method === "POST"
            ? z.object({ model: z.string() }).parse(await request.json()).model
            : null,
      })
      if (url.pathname === `${ollamaDaemonPrefix}/api/tags`) {
        return Response.json({ models: [{ name: ollamaModelName }] })
      }
      if (url.pathname === `${ollamaDaemonPrefix}/api/chat`) {
        const model = requests.at(-1)?.model
        if (model !== ollamaModelName && !(model === ollamaCloudModelName && cloudPulled)) {
          return new Response(null, { status: 409 })
        }
        return new Response(
          `${JSON.stringify({ message: { role: "assistant", content: ollamaChatText }, done: true, done_reason: "stop" })}\n`,
          { headers: { "content-type": "application/x-ndjson" } },
        )
      }
      if (url.pathname === `${ollamaDaemonPrefix}/api/pull`) {
        if (requests.at(-1)?.model !== ollamaCloudModelName || cloudPulled) {
          return new Response(null, { status: 409 })
        }
        cloudPulled = true
        return new Response(`${JSON.stringify({ status: "success" })}\n`, {
          headers: { "content-type": "application/x-ndjson" },
        })
      }
      return new Response(null, { status: 404 })
    },
  })
  return {
    baseURL: `http://127.0.0.1:${server.port}${ollamaDaemonPrefix}`,
    requests: () => requests,
    cloudRequests: () => cloudRequests,
    stop: () => server.stop(true),
  }
}

export async function cloudFixturePlugin(
  packed: PackedV2Plugin,
  daemon: LoopbackDaemon,
): Promise<string> {
  const captureUrl = new URL("/fixture-cloud", daemon.baseURL).href
  const wrapperPath = join(packed.directory, `cloud-fixture-${new URL(daemon.baseURL).port}.mjs`)
  await writeFile(
    wrapperPath,
    `const originalFetch = globalThis.fetch;
const responses = ${JSON.stringify(cloudDiscoveryResponses)};
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === "https://ollama.com" || url.origin === "https://registry.ollama.ai") {
    const capture = await originalFetch(${JSON.stringify(captureUrl)}, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: request.url, headers: Object.fromEntries(request.headers), credentials: init?.credentials ?? request.credentials, method: request.method, redirect: request.redirect }),
    });
    if (!capture.ok) throw new Error("Cloud fixture capture failed");
    const body = responses[request.url];
    if (request.method === "GET" && body !== undefined) return new Response(body, {
      headers: { "content-type": url.pathname.includes("/manifests/") ? "application/vnd.docker.distribution.manifest.v2+json" : "application/json" },
    });
  }
  return originalFetch(input, init);
};
export { default } from ${JSON.stringify(packed.fileUrl)};
`,
    "utf8",
  )
  await writeFile(
    join(packed.directory, "server.js"),
    `export { default } from ${JSON.stringify(pathToFileURL(wrapperPath).href)};\n`,
  )
  return pathToFileURL(packed.directory).href
}

export function contactedOllamaCloud(hosts: readonly string[]): boolean {
  return hosts.some((line) => /ollama\.com|registry\.ollama\.ai/u.test(line.toLowerCase()))
}
