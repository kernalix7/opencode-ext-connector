import type { OllamaFetch } from "../../../../src/providers/ollama/http"
import { FakeFetch } from "./http-fake"

// Event-driven, abort-aware wire fake; each URL's gate is used for one request.
export class LifecycleFetch {
  readonly replies = new FakeFetch()
  readonly requests: { readonly url: string; readonly init: RequestInit | undefined }[] = []
  readonly active = new Set<string>()
  readonly aborts = new Set<string>()
  private readonly gates = new Map<string, PromiseWithResolvers<void>>()
  private readonly starts = new Map<string, PromiseWithResolvers<void>>()
  private readonly cancellations = new Map<string, PromiseWithResolvers<void>>()
  private readonly cleanup = new Map<string, PromiseWithResolvers<void>>()

  block(url: string): void {
    this.gates.set(url, Promise.withResolvers<void>())
  }

  blockCleanup(url: string): void {
    this.cleanup.set(url, Promise.withResolvers<void>())
  }

  release(url: string): void {
    this.gates.get(url)?.resolve()
    this.cleanup.get(url)?.resolve()
  }

  started(url: string): Promise<void> {
    if (this.requests.some((request) => request.url === url)) return Promise.resolve()
    const event = this.starts.get(url) ?? Promise.withResolvers<void>()
    this.starts.set(url, event)
    return event.promise
  }

  aborted(url: string): Promise<void> {
    if (this.aborts.has(url)) return Promise.resolve()
    const event = this.cancellations.get(url) ?? Promise.withResolvers<void>()
    this.cancellations.set(url, event)
    return event.promise
  }

  readonly fetch: OllamaFetch = async (url, init) => {
    this.requests.push({ url, init })
    this.active.add(url)
    this.starts.get(url)?.resolve()
    const signal = init?.signal
    const cancellation = Promise.withResolvers<never>()
    const onAbort = (): void => {
      this.aborts.add(url)
      this.cancellations.get(url)?.resolve()
      cancellation.reject(new DOMException("fixture cancellation", "AbortError"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    try {
      if (signal?.aborted) throw new DOMException("fixture cancellation", "AbortError")
      await Promise.race([this.gates.get(url)?.promise ?? Promise.resolve(), cancellation.promise])
      return await this.replies.fetch(url, init)
    } finally {
      signal?.removeEventListener("abort", onAbort)
      await this.cleanup.get(url)?.promise
      this.active.delete(url)
    }
  }
}
