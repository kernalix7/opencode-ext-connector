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

export function cursorPromptText(prompt: LanguageModelV3CallOptions["prompt"]): string {
  const parts: string[] = []
  let hasToolResults = false
  for (const message of prompt) {
    switch (message.role) {
      case "system":
        parts.push(message.content)
        break
      case "user":
      case "assistant":
        parts.push(textFromContentParts(message.content))
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
