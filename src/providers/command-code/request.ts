// Derived from thaolaptrinh/commandcode-api-proxy@f4b3390e2f18a42bc164a1a94a4d796e20d19700.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import { randomUUID } from "node:crypto"
import { homedir } from "node:os"

export type BuildHeadersOptions = {
  readonly token: string
  readonly cliVersion: string
}

export type BuildBodyOptions = {
  readonly modelId: string
  readonly messages: readonly { readonly role: string; readonly content: string }[]
  readonly threadId?: string
}

function getProjectSlug(): string {
  try {
    const cwd = process.cwd()
    const home = homedir()
    if (cwd.startsWith(home)) {
      const relative = cwd.slice(home.length + 1)
      return relative.replaceAll("/", "-") || "home"
    }
    return cwd.split("/").pop() || "project"
  } catch {
    return "project"
  }
}

function generateTraceparent(): string {
  const traceId = randomUUID().replaceAll("-", "")
  const spanId = randomUUID().replaceAll("-", "").slice(0, 16)
  return `00-${traceId}-${spanId}-01`
}

export function buildHeaders(options: BuildHeadersOptions): Record<string, string> {
  const { token, cliVersion } = options
  const projectSlug = getProjectSlug()
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "user-agent": `commandcode-cli/${cliVersion}`,
    "x-cli-environment": "desktop",
    "x-session-id": randomUUID(),
    "x-command-code-version": cliVersion,
    "x-project-slug": projectSlug,
    traceparent: generateTraceparent(),
  }
}

export function buildBody(options: BuildBodyOptions): Record<string, unknown> {
  const { modelId, messages, threadId } = options
  return {
    config: {},
    memory: {},
    taste: {},
    skills: {},
    permissionMode: "default",
    threadId: threadId ?? randomUUID(),
    params: {
      stream: true,
      model: modelId,
      messages,
    },
  }
}
