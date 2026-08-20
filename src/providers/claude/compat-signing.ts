// Derived from griffinmartin/opencode-claude-auth@0f0ff6f12c367339130cbfd250393863ed2c8d9e.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import { createHash } from "node:crypto"

const BILLING_SALT = "59cf53e54c78"

type SigningMessage = {
  readonly role?: string
  readonly content?: string | readonly { readonly type?: string; readonly text?: string }[]
}

function firstUserText(messages: readonly SigningMessage[]): string {
  const message = messages.find((candidate) => candidate.role === "user")
  if (message === undefined) {
    return ""
  }
  if (typeof message.content === "string") {
    return message.content
  }
  return message.content?.find((block) => block.type === "text")?.text ?? ""
}

function hashPrefix(value: string, length: number): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length)
}

export function claudeBillingHeader(
  messages: readonly SigningMessage[],
  version: string,
  entrypoint: string,
): string {
  const text = firstUserText(messages)
  const sampled = [4, 7, 20].map((index) => text[index] ?? "0").join("")
  const suffix = hashPrefix(`${BILLING_SALT}${sampled}${version}`, 3)
  const cch = hashPrefix(text, 5)
  return `x-anthropic-billing-header: cc_version=${version}.${suffix}; cc_entrypoint=${entrypoint}; cch=${cch};`
}
