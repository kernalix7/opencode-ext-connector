// Derived from brent-weatherall/opencode-commandcode-provider src/convert.ts.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import type { LanguageModelV3CallOptions, LanguageModelV3ToolResultOutput } from "@ai-sdk/provider"

export type BuildHeadersOptions = {
  readonly token: string
  readonly cliVersion: string
}

export type BuildBodyOptions = {
  readonly modelId: string
  readonly call: LanguageModelV3CallOptions
}

type CommandCodeMessage =
  | { readonly role: "user"; readonly content: string }
  | { readonly role: "assistant"; readonly content: readonly CommandCodeAssistantPart[] }
  | { readonly role: "tool"; readonly content: readonly CommandCodeToolResult[] }

type CommandCodeAssistantPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "reasoning"; readonly text: string }
  | {
      readonly type: "tool-call"
      readonly toolCallId: string
      readonly toolName: string
      readonly input: unknown
    }

type CommandCodeToolResult = {
  readonly type: "tool-result"
  readonly toolCallId: string
  readonly toolName: string
  readonly output:
    | { readonly type: "text"; readonly value: string }
    | { readonly type: "error-text"; readonly value: string }
}

type CommandCodeTool = {
  readonly type: "function"
  readonly name: string
  readonly description?: string
  readonly input_schema: unknown
}

export function buildHeaders(options: BuildHeadersOptions): Record<string, string> {
  const { token, cliVersion } = options
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-cli-environment": "production",
    "x-command-code-version": cliVersion,
    "x-project-slug": "opencode",
  }
}

function toolResultOutput(
  output: LanguageModelV3ToolResultOutput,
): CommandCodeToolResult["output"] {
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
          .map((part) =>
            "text" in part && typeof part.text === "string" ? part.text : JSON.stringify(part),
          )
          .join("\n"),
      }
  }
}

function messagesFromCall(call: LanguageModelV3CallOptions): {
  readonly messages: readonly CommandCodeMessage[]
  readonly system: string
} {
  const messages: CommandCodeMessage[] = []
  const system: string[] = []
  for (const message of call.prompt) {
    if (message.role === "system") {
      system.push(message.content)
      continue
    }
    if (message.role === "user") {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
      messages.push({ role: "user", content: text })
      continue
    }
    if (message.role === "assistant") {
      const content: CommandCodeAssistantPart[] = []
      for (const part of message.content) {
        if (part.type === "text" || part.type === "reasoning") {
          content.push({ type: part.type, text: part.text })
        }
        if (part.type === "tool-call") {
          content.push({
            type: "tool-call",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.input,
          })
        }
      }
      messages.push({ role: "assistant", content })
      continue
    }
    const content: CommandCodeToolResult[] = []
    for (const part of message.content) {
      if (part.type !== "tool-result") {
        continue
      }
      content.push({
        type: "tool-result",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        output: toolResultOutput(part.output),
      })
    }
    messages.push({ role: "tool", content })
  }
  return { messages, system: system.join("\n\n") }
}

function toolsFromCall(call: LanguageModelV3CallOptions): readonly CommandCodeTool[] {
  const tools: CommandCodeTool[] = []
  for (const tool of call.tools ?? []) {
    if (tool.type !== "function") {
      continue
    }
    tools.push({
      type: "function",
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      input_schema: tool.inputSchema,
    })
  }
  return tools
}

export function buildBody(options: BuildBodyOptions): Record<string, unknown> {
  const converted = messagesFromCall(options.call)
  const workingDir = process.cwd()
  const params: Record<string, unknown> = {
    model: options.modelId,
    messages: converted.messages,
    tools: toolsFromCall(options.call),
    system: converted.system,
    max_tokens: options.call.maxOutputTokens ?? 16_384,
    stream: true,
  }
  if (options.call.temperature !== undefined) {
    params["temperature"] = options.call.temperature
  }
  if (options.call.topP !== undefined) {
    params["top_p"] = options.call.topP
  }
  if (options.call.topK !== undefined) {
    params["top_k"] = options.call.topK
  }
  return {
    config: {
      workingDir,
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
    params,
  }
}
