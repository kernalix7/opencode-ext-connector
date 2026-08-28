export type RecordedFetch = {
  readonly url: string
  readonly init: RequestInit | undefined
}

type FetchReply = Response | Error

export class FakeFetch {
  public readonly requests: RecordedFetch[] = []
  public maximumActive = 0
  private active = 0
  private readonly replies = new Map<string, FetchReply[]>()
  private readonly blocked = new Map<string, PromiseWithResolvers<void>>()

  public enqueue(url: string, reply: FetchReply): void {
    const queued = this.replies.get(url) ?? []
    queued.push(reply)
    this.replies.set(url, queued)
  }

  public block(url: string): void {
    this.blocked.set(url, Promise.withResolvers<void>())
  }

  public release(url: string): void {
    this.blocked.get(url)?.resolve()
  }

  public readonly fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    this.requests.push({ url, init })
    this.active += 1
    this.maximumActive = Math.max(this.maximumActive, this.active)
    try {
      await this.blocked.get(url)?.promise
      const reply = this.replies.get(url)?.shift()
      if (reply === undefined) throw new TypeError("missing fake response")
      if (reply instanceof Error) throw reply
      return reply
    } finally {
      this.active -= 1
    }
  }
}

export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { "content-type": "text/html" } })
}

export function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}
