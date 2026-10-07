// Derived from brent-weatherall/opencode-commandcode-provider src/convert.ts.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.
import { randomBytes } from "node:crypto"
import type { LanguageModelV3CallOptions, LanguageModelV3ToolResultOutput } from "@ai-sdk/provider"
import type { CommandCodeSessionId } from "./session.js"

export type BuildHeadersOptions = {
  readonly token: string
  readonly cliVersion: string
  readonly sessionId: CommandCodeSessionId
}
export type BuildBodyOptions = {
  readonly modelId: string
  readonly call: LanguageModelV3CallOptions
  readonly sessionId: CommandCodeSessionId
}

export function buildHeaders({
  token,
  cliVersion,
  sessionId,
}: BuildHeadersOptions): Record<string, string> {
  return {
    accept: "application/json, */*",
    "accept-encoding": "gzip, deflate, br",
    "accept-language": "en-US,en;q=0.9",
    authorization: `Bearer ${token}`,
    connection: "keep-alive",
    "content-type": "application/json",
    traceparent: `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`,
    "user-agent": `commandcode-cli/${cliVersion} Node.js/${process.version}`,
    "x-cli-environment": "production",
    "x-co-flag": "false",
    "x-command-code-version": cliVersion,
    "x-project-slug": "opencode",
    "x-session-id": sessionId,
    "x-taste-learning": "false",
  }
}

function toolOutput(output: LanguageModelV3ToolResultOutput): {
  readonly type: "text" | "error-text"
  readonly value: string
} {
  switch (output.type) {
    case "text":
    case "error-text":
      return { type: output.type, value: output.value }
    case "json":
      return { type: "text", value: JSON.stringify(output.value) }
    case "error-json":
      return { type: "error-text", value: JSON.stringify(output.value) }
    case "execution-denied":
      return { type: "error-text", value: output.reason ?? "Execution denied" }
    case "content":
      return {
        type: "text",
        value: output.value
          .map((part) => ("text" in part ? part.text : JSON.stringify(part)))
          .join("\n"),
      }
    default: {
      const exhaustive: never = output
      return exhaustive
    }
  }
}

function imageData(data: Uint8Array | string | URL, mediaType: string): string {
  if (data instanceof URL) return data.toString()
  return `data:${mediaType};base64,${typeof data === "string" ? data : Buffer.from(data).toString("base64")}`
}

function messagesFromCall(call: LanguageModelV3CallOptions): {
  readonly messages: readonly unknown[]
  readonly system: string
} {
  const messages: unknown[] = []
  const system: string[] = []
  for (const message of call.prompt) {
    switch (message.role) {
      case "system":
        system.push(message.content)
        break
      case "user": {
        const content: unknown[] = []
        for (const part of message.content) {
          switch (part.type) {
            case "text":
              content.push({ type: "text", text: part.text })
              break
            case "file":
              if (part.mediaType.startsWith("image/"))
                content.push({
                  type: "image",
                  image: imageData(part.data, part.mediaType),
                  mimeType: part.mediaType,
                })
              break
            default: {
              const exhaustive: never = part
              return exhaustive
            }
          }
        }
        messages.push({ role: "user", content })
        break
      }
      case "assistant": {
        const content: unknown[] = []
        for (const part of message.content) {
          switch (part.type) {
            case "text":
            case "reasoning":
              content.push({ type: part.type, text: part.text })
              break
            case "tool-call":
              content.push({
                type: "tool-call",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.input,
              })
              break
            case "file":
            case "tool-result":
              break
            default: {
              const exhaustive: never = part
              return exhaustive
            }
          }
        }
        messages.push({ role: "assistant", content })
        break
      }
      case "tool": {
        const content: unknown[] = []
        for (const part of message.content) {
          switch (part.type) {
            case "tool-result":
              content.push({
                type: "tool-result",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                output: toolOutput(part.output),
              })
              break
            case "tool-approval-response":
              break
            default: {
              const exhaustive: never = part
              return exhaustive
            }
          }
        }
        messages.push({ role: "tool", content })
        break
      }
      default: {
        const exhaustive: never = message
        return exhaustive
      }
    }
  }
  return { messages, system: system.join("\n\n") }
}

export function buildBody({ modelId, call, sessionId }: BuildBodyOptions): Record<string, unknown> {
  const converted = messagesFromCall(call)
  const params: Record<string, unknown> = {
    model: modelId,
    messages: converted.messages,
    tools: (call.tools ?? [])
      .filter((tool) => tool.type === "function")
      .map((tool) => ({
        type: "function",
        name: tool.name,
        ...(tool.description === undefined ? {} : { description: tool.description }),
        input_schema: tool.inputSchema,
      })),
    system: converted.system,
    max_tokens: call.maxOutputTokens ?? 16_384,
    stream: true,
  }
  if (call.temperature !== undefined) params["temperature"] = call.temperature
  if (call.topP !== undefined) params["top_p"] = call.topP
  if (call.topK !== undefined) params["top_k"] = call.topK
  return {
    config: {
      workingDir: process.cwd(),
      date: new Date().toISOString().slice(0, 10),
      environment: `${process.platform}-${process.arch}`,
      structure: [],
      isGitRepo: false,
      currentBranch: "",
      mainBranch: "",
      gitStatus: "",
      recentCommits: [],
    },
    memory: "",
    taste: "",
    skills: null,
    permissionMode: "standard",
    threadId: sessionId,
    params,
  }
}
