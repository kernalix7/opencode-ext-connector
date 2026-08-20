import { createHash } from "node:crypto"

import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"

function toolResultBody(part: object): string {
  if (!("output" in part)) {
    return ""
  }
  const output = Reflect.get(part, "output")
  if (typeof output === "string") {
    return output
  }
  if (typeof output === "object" && output !== null && "value" in output) {
    const value = Reflect.get(output, "value")
    return typeof value === "string" ? value : JSON.stringify(value)
  }
  return JSON.stringify(output)
}

function textFromContentParts(parts: readonly { readonly type: string }[]): string {
  const texts: string[] = []
  for (const part of parts) {
    if (part.type === "text" && "text" in part && typeof part.text === "string") {
      texts.push(part.text)
    }
    if (part.type === "tool-call") {
      const id =
        "toolCallId" in part && typeof part.toolCallId === "string" ? part.toolCallId : "unknown"
      const name =
        "toolName" in part && typeof part.toolName === "string" ? part.toolName : "unknown"
      const input = "input" in part ? JSON.stringify(Reflect.get(part, "input")) : "{}"
      texts.push(`tool_call(${name}, ${id}): ${input}`)
    }
    if (part.type === "tool-result") {
      const id =
        "toolCallId" in part && typeof part.toolCallId === "string" ? part.toolCallId : "unknown"
      const name =
        "toolName" in part && typeof part.toolName === "string" ? part.toolName : undefined
      const body = toolResultBody(part)
      texts.push(
        name === undefined
          ? `TOOL_RESULT (call_id: ${id}): ${body}`
          : `TOOL_RESULT (name: ${name}, call_id: ${id}): ${body}`,
      )
    }
  }
  return texts.join("")
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32)
}

function isMetaPrompt(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.includes("title generator") ||
    lower.includes("thread title") ||
    lower.includes("generate a brief title")
  )
}

export function cursorSessionKey(call: LanguageModelV3CallOptions): string | null {
  const firstUser = call.prompt.find((message) => {
    if (message.role !== "user") {
      return false
    }
    const text = textFromContentParts(message.content).trim()
    return text.length > 0 && !isMetaPrompt(text)
  })
  if (firstUser === undefined || firstUser.role !== "user") {
    return null
  }
  const opener = textFromContentParts(firstUser.content).trim()
  const tools = (call.tools ?? [])
    .filter((tool) => tool.type === "function")
    .map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema,
    }))
  return `${hash(opener)}\0${hash(JSON.stringify(tools))}`
}

export function cursorIncrementalPrompt(call: LanguageModelV3CallOptions): string | null {
  const last = call.prompt.at(-1)
  if (last?.role === "user") {
    const text = textFromContentParts(last.content).trim()
    return text.length > 0 ? text : null
  }
  if (last?.role !== "tool") {
    return null
  }
  let firstToolIndex = call.prompt.length - 1
  while (firstToolIndex > 0 && call.prompt[firstToolIndex - 1]?.role === "tool") {
    firstToolIndex -= 1
  }
  const parts: string[] = []
  const assistant = call.prompt[firstToolIndex - 1]
  if (assistant?.role === "assistant") {
    parts.push(`ASSISTANT: ${textFromContentParts(assistant.content)}`)
  }
  for (let index = firstToolIndex; index < call.prompt.length; index += 1) {
    const message = call.prompt[index]
    if (message?.role === "tool") {
      parts.push(textFromContentParts(message.content))
    }
  }
  parts.push(
    "The above tool calls have been executed. Continue your response based on these results.",
  )
  return parts.join("\n\n")
}

function toolDefinitions(call: LanguageModelV3CallOptions): string | null {
  const tools = (call.tools ?? []).filter((tool) => tool.type === "function")
  if (tools.length === 0) {
    return null
  }
  const definitions = tools
    .map((tool) => {
      const description = tool.description ?? ""
      return `- ${tool.name}: ${description}\n  Parameters: ${JSON.stringify(tool.inputSchema)}`
    })
    .join("\n")
  return [
    "SYSTEM: You have access to the following tools. When you need to use one, respond with a tool_call in the standard OpenAI format.",
    "Tool guidance: prefer write/edit for file changes; use bash mainly to run commands/tests.",
    "",
    `Available tools:\n${definitions}`,
  ].join("\n")
}

export function cursorPromptText(call: LanguageModelV3CallOptions): string {
  const parts: string[] = []
  const definitions = toolDefinitions(call)
  if (definitions !== null) {
    parts.push(definitions)
  }
  let hasToolResults = false
  for (const message of call.prompt) {
    switch (message.role) {
      case "system":
        parts.push(`SYSTEM: ${message.content}`)
        break
      case "user":
        parts.push(`USER: ${textFromContentParts(message.content)}`)
        break
      case "assistant":
        parts.push(`ASSISTANT: ${textFromContentParts(message.content)}`)
        break
      case "tool":
        hasToolResults = true
        parts.push(textFromContentParts(message.content))
        break
    }
  }
  if (hasToolResults) {
    parts.push(
      "The above tool calls have been executed. Continue your response based on these results.",
    )
  }
  return parts.join("\n")
}
