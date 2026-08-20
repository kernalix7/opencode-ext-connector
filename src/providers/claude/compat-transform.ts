// Derived from griffinmartin/opencode-claude-auth@0f0ff6f12c367339130cbfd250393863ed2c8d9e.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import { claudeModelOverride } from "./compat-config"
import { claudeBillingHeader } from "./compat-signing"

export const CLAUDE_SYSTEM_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude."
const BILLING_PREFIX = "x-anthropic-billing-header"
const TOOL_PREFIX = "mcp_"
const TOOL_RESULT_PLACEHOLDER = "Tool result unavailable (removed during context compaction)."

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    result[key] = Reflect.get(value, key)
  }
  return result
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key]
  return typeof field === "string" ? field : undefined
}

function prefixToolName(name: string): string {
  return `${TOOL_PREFIX}${name.charAt(0).toUpperCase()}${name.slice(1)}`
}

function contentRecords(message: Record<string, unknown>): Record<string, unknown>[] | null {
  const content = message["content"]
  if (!Array.isArray(content)) {
    return null
  }
  return content.map(record).filter((part): part is Record<string, unknown> => part !== null)
}

function toolIds(
  message: Record<string, unknown> | undefined,
  type: "tool_use" | "tool_result",
): readonly string[] {
  if (message === undefined) {
    return []
  }
  const key = type === "tool_use" ? "id" : "tool_use_id"
  return (contentRecords(message) ?? [])
    .filter((part) => part["type"] === type)
    .map((part) => stringField(part, key))
    .filter((id): id is string => id !== undefined)
}

function repairToolPairs(messages: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const withoutOrphanResults: Record<string, unknown>[] = []
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message === undefined) {
      continue
    }
    const content = contentRecords(message)
    if (content === null) {
      withoutOrphanResults.push(message)
      continue
    }
    const previousUses = new Set(toolIds(messages[index - 1], "tool_use"))
    const filtered = content.filter((part) => {
      const resultId = part["type"] === "tool_result" ? stringField(part, "tool_use_id") : undefined
      return resultId === undefined || previousUses.has(resultId)
    })
    if (filtered.length > 0 || content.length === 0) {
      withoutOrphanResults.push({ ...message, content: filtered })
    }
  }

  const output: Record<string, unknown>[] = []
  for (let index = 0; index < withoutOrphanResults.length; index += 1) {
    const message = withoutOrphanResults[index]
    if (message === undefined) {
      continue
    }
    output.push(message)
    const uses = toolIds(message, "tool_use")
    if (uses.length === 0) {
      continue
    }
    const next = withoutOrphanResults[index + 1]
    const results = new Set(toolIds(next, "tool_result"))
    const missing = uses.filter((id) => !results.has(id))
    if (missing.length === 0) {
      continue
    }
    const synthetic = missing.map((id) => ({
      type: "tool_result",
      tool_use_id: id,
      content: TOOL_RESULT_PLACEHOLDER,
      is_error: true,
    }))
    if (next?.["role"] === "user") {
      const nextContent = next["content"]
      const merged =
        typeof nextContent === "string"
          ? [...synthetic, ...(nextContent.length > 0 ? [{ type: "text", text: nextContent }] : [])]
          : [...synthetic, ...(contentRecords(next) ?? [])]
      output.push({ ...next, content: merged })
      index += 1
    } else {
      output.push({ role: "user", content: synthetic })
    }
  }
  return output
}

function transformTools(body: Record<string, unknown>): void {
  const tools = body["tools"]
  if (Array.isArray(tools)) {
    body["tools"] = tools.map((value) => {
      const tool = record(value)
      if (tool === null) {
        return value
      }
      const name = stringField(tool, "name")
      return name === undefined ? tool : { ...tool, name: prefixToolName(name) }
    })
  }
}

function transformMessages(body: Record<string, unknown>): Record<string, unknown>[] {
  const raw = body["messages"]
  if (!Array.isArray(raw)) {
    return []
  }
  const messages = raw
    .map(record)
    .filter((value): value is Record<string, unknown> => value !== null)
  const prefixed = messages.map((message) => {
    const content = contentRecords(message)
    if (content === null) {
      return message
    }
    return {
      ...message,
      content: content.map((part) => {
        const name = part["type"] === "tool_use" ? stringField(part, "name") : undefined
        return name === undefined ? part : { ...part, name: prefixToolName(name) }
      }),
    }
  })
  return repairToolPairs(prefixed)
}

function transformSystem(
  body: Record<string, unknown>,
  messages: Record<string, unknown>[],
  version: string,
): void {
  const system = body["system"]
  const entries = Array.isArray(system)
    ? system.map(record).filter((value): value is Record<string, unknown> => value !== null)
    : typeof system === "string"
      ? [{ type: "text", text: system }]
      : []
  const billing = claudeBillingHeader(
    messages,
    version,
    process.env["CLAUDE_CODE_ENTRYPOINT"] ?? "sdk-cli",
  )
  const moved: string[] = []
  const kept: Record<string, unknown>[] = [{ type: "text", text: billing }]
  let hasIdentity = false
  for (const entry of entries) {
    const text = stringField(entry, "text") ?? ""
    if (text.startsWith(BILLING_PREFIX)) {
      continue
    }
    if (text.startsWith(CLAUDE_SYSTEM_IDENTITY)) {
      kept.push({ type: "text", text: CLAUDE_SYSTEM_IDENTITY })
      hasIdentity = true
      const remainder = text.slice(CLAUDE_SYSTEM_IDENTITY.length).replace(/^\n+/, "")
      if (remainder.length > 0) {
        moved.push(remainder)
      }
    } else if (text.length > 0) {
      moved.push(text)
    }
  }
  if (!hasIdentity) {
    kept.push({ type: "text", text: CLAUDE_SYSTEM_IDENTITY })
  }
  if (moved.length > 0) {
    const firstUser = messages.find((message) => message["role"] === "user")
    if (firstUser !== undefined) {
      const prefix = moved.join("\n\n")
      const content = firstUser["content"]
      firstUser["content"] =
        typeof content === "string"
          ? `${prefix}\n\n${content}`
          : [{ type: "text", text: prefix }, ...(contentRecords(firstUser) ?? [])]
    }
  }
  body["system"] = kept
}

function stripUnsupportedEffort(body: Record<string, unknown>): void {
  const model = typeof body["model"] === "string" ? body["model"] : ""
  if (claudeModelOverride(model)?.disableEffort !== true) {
    return
  }
  for (const key of ["output_config", "thinking"]) {
    const value = record(body[key])
    if (value === null) {
      continue
    }
    delete value["effort"]
    if (Object.keys(value).length === 0) {
      delete body[key]
    } else {
      body[key] = value
    }
  }
}

export function transformClaudeBody(
  body: RequestInit["body"],
  version: string,
): RequestInit["body"] {
  if (typeof body !== "string") {
    return body
  }
  try {
    const parsed = record(JSON.parse(body))
    if (parsed === null) {
      return body
    }
    const messages = transformMessages(parsed)
    parsed["messages"] = messages
    transformSystem(parsed, messages, version)
    transformTools(parsed)
    stripUnsupportedEffort(parsed)
    return JSON.stringify(parsed)
  } catch {
    return body
  }
}

export function stripClaudeToolPrefix(text: string): string {
  return text.replace(/"name"\s*:\s*"mcp_([^"]+)"/g, (_match, name: string) => {
    return `"name": "${name.charAt(0).toLowerCase()}${name.slice(1)}"`
  })
}
