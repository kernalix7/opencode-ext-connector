import type { Plugin as V1Plugin } from "@opencode-ai/plugin"

class XaiOAuthRetiredError extends Error {
  public override readonly name = "XaiOAuthRetiredError"

  public constructor() {
    super("xAI OAuth projection is retired; use native xAI API-key authentication.")
  }
}

export const xaiAuthServer: V1Plugin = async () => {
  throw new XaiOAuthRetiredError()
}
