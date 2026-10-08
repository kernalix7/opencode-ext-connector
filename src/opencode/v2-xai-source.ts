import { createHash } from "node:crypto"

import { XaiAccessUnavailableError } from "../providers/xai/request-binding.js"
import type { CredentialV2, PluginV2ConnectionInfo } from "./beta-api.js"
import type { V2ConnectionSource } from "./v2-auth.js"

export type XaiSelectedSource = {
  readonly identity: string
  readonly fingerprint: string
}

function identity(connection: PluginV2ConnectionInfo): string {
  switch (connection.type) {
    case "credential":
      return `credential:${connection.id}:${connection.method}`
    case "env":
      return `env:${connection.name}`
  }
}

function fingerprint(value: CredentialV2.Value): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

export async function observeXaiSelected(
  source: V2ConnectionSource,
): Promise<XaiSelectedSource | null> {
  const selected = await source.active("xai")
  if (selected === undefined) return null
  if (selected.status !== undefined) throw new XaiAccessUnavailableError()
  const value = await source.resolve(selected)
  if (value === undefined) throw new XaiAccessUnavailableError()
  return {
    identity: identity(selected),
    fingerprint: fingerprint(value),
  }
}
