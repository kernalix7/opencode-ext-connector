import type {
  LanguageModelV3CallOptions,
  LanguageModelV3ToolResultOutput,
  SharedV3Warning,
} from "@ai-sdk/provider"

import { OllamaGenerationError } from "./errors"
import type { OllamaChatRequest, OllamaMessage } from "./protocol"

type BuiltOllamaCall = {
  readonly request: OllamaChatRequest
  readonly warnings: SharedV3Warning[]
}

function unsupported(): never {
  throw new OllamaGenerationError("prompt")
}

function resultText(output: LanguageModelV3ToolResultOutput): string {
  switch (output.type) {
    case "text":
    case "error-text":
      return output.value
    case "json":
    case "error-json":
      return JSON.stringify(output.value)
    case "execution-denied":
      return output.reason ?? "Tool execution denied"
    case "content":
      return unsupported()
  }
}

function messagesFromCall(call: LanguageModelV3CallOptions): readonly OllamaMessage[] {
  const messages: OllamaMessage[] = []
  const pendingCalls = new Map<string, string>()
  for (const message of call.prompt) {
    if (pendingCalls.size > 0 && message.role !== "tool") unsupported()
    switch (message.role) {
      case "system":
        messages.push({ role: "system", content: message.content })
        break
      case "user":
        messages.push({
          role: "user",
          content: message.content
            .map((part) => (part.type === "text" ? part.text : unsupported()))
            .join(""),
        })
        break
      case "assistant": {
        const text: string[] = []
        const thinking: string[] = []
        const calls: Array<{
          readonly function: {
            readonly name: string
            readonly arguments: Readonly<Record<string, unknown>>
          }
        }> = []
        for (const part of message.content) {
          switch (part.type) {
            case "text":
              text.push(part.text)
              break
            case "reasoning":
              thinking.push(part.text)
              break
            case "tool-call":
              if (
                part.providerExecuted === true ||
                part.toolCallId.length === 0 ||
                part.toolName.length === 0 ||
                pendingCalls.has(part.toolCallId) ||
                typeof part.input !== "object" ||
                part.input === null ||
                Array.isArray(part.input)
              )
                unsupported()
              calls.push({
                function: {
                  name: part.toolName,
                  arguments: Object.fromEntries(Object.entries(part.input)),
                },
              })
              pendingCalls.set(part.toolCallId, part.toolName)
              break
            case "tool-result":
              return unsupported()
            case "file":
              return unsupported()
          }
        }
        messages.push({
          role: "assistant",
          content: text.join(""),
          ...(thinking.length === 0 ? {} : { thinking: thinking.join("") }),
          ...(calls.length === 0 ? {} : { tool_calls: calls }),
        })
        break
      }
      case "tool":
        for (const part of message.content) {
          if (part.type !== "tool-result") unsupported()
          if (pendingCalls.get(part.toolCallId) !== part.toolName) unsupported()
          messages.push({
            role: "tool",
            content: resultText(part.output),
            tool_name: part.toolName,
          })
          pendingCalls.delete(part.toolCallId)
        }
        break
    }
  }
  return messages
}

export function buildOllamaCall(
  modelId: string,
  call: LanguageModelV3CallOptions,
): BuiltOllamaCall {
  const warnings: SharedV3Warning[] = []
  if (call.presencePenalty !== undefined)
    warnings.push({ type: "unsupported", feature: "presencePenalty" })
  if (call.frequencyPenalty !== undefined)
    warnings.push({ type: "unsupported", feature: "frequencyPenalty" })
  if (call.toolChoice !== undefined) warnings.push({ type: "unsupported", feature: "toolChoice" })
  if (call.headers !== undefined) warnings.push({ type: "unsupported", feature: "headers" })
  const tools = call.tools?.map((tool) => {
    if (tool.type !== "function") return unsupported()
    return {
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description ?? "",
        parameters: tool.inputSchema,
      },
    }
  })
  const requestOptions = {
    ...(call.maxOutputTokens === undefined ? {} : { num_predict: call.maxOutputTokens }),
    ...(call.temperature === undefined ? {} : { temperature: call.temperature }),
    ...(call.topP === undefined ? {} : { top_p: call.topP }),
    ...(call.topK === undefined ? {} : { top_k: call.topK }),
    ...(call.seed === undefined ? {} : { seed: call.seed }),
    ...(call.stopSequences === undefined ? {} : { stop: call.stopSequences }),
  }
  return {
    request: {
      model: modelId,
      stream: true,
      messages: messagesFromCall(call),
      ...(tools === undefined ? {} : { tools }),
      ...(call.responseFormat?.type === "json"
        ? { format: call.responseFormat.schema ?? "json" }
        : {}),
      ...(Object.keys(requestOptions).length === 0 ? {} : { options: requestOptions }),
    },
    warnings,
  }
}
