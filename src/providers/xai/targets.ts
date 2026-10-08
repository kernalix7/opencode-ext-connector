/** Credential-bearing xAI consumer traffic is limited to the official API origin. */
export class XaiTargetError extends Error {
  public override readonly name = "XaiTargetError"
  public constructor() {
    super("xAI consumer target is not trusted")
  }
}

export function assertXaiTarget(input: string | URL | Request, transport: "http" | "ws"): void {
  let url: URL
  try {
    url = new URL(input instanceof Request ? input.url : input)
  } catch (error: unknown) {
    if (error instanceof TypeError) throw new XaiTargetError()
    throw error
  }
  if (
    url.protocol !== (transport === "http" ? "https:" : "wss:") ||
    url.hostname !== "api.x.ai" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "/v1" && !url.pathname.startsWith("/v1/")) ||
    url.hash !== ""
  )
    throw new XaiTargetError()
  for (const key of url.searchParams.keys()) {
    if (
      /^(?:access[_-]?token|api[_-]?key|authorization|auth|token|bearer|refresh[_-]?token)$/i.test(
        key,
      )
    ) {
      throw new XaiTargetError()
    }
  }
}
