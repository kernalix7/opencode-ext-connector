// Derived from griffinmartin/opencode-claude-auth@0f0ff6f12c367339130cbfd250393863ed2c8d9e.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

export type ToolUseBlock = {
  readonly type: "tool_use"
  readonly id: string
  readonly name: string
  readonly input: Record<string, unknown>
}

export type ToolResultBlock = {
  readonly type: "tool_result"
  readonly tool_use_id: string
  readonly content: string
  readonly is_error: true
}

export type ContentBlock =
  | ToolUseBlock
  | ToolResultBlock
  | { readonly type: "text"; readonly text: string }
  | { readonly type: string; readonly [key: string]: unknown }

export type Message = {
  readonly role: "user" | "assistant" | "system"
  readonly content: string | readonly ContentBlock[]
}

export type RequestBody = {
  readonly model: string
  readonly max_tokens: number
  readonly system?: string
  readonly messages: readonly Message[]
  readonly stream?: boolean
  readonly [key: string]: unknown
}

function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string"
}

function isToolResultBlock(block: ContentBlock): block is ToolResultBlock {
  return block.type === "tool_result" && typeof block.tool_use_id === "string"
}

function findOrphanToolUses(content: readonly ContentBlock[]): ToolUseBlock[] {
  const toolUseIds = new Set<string>()
  const toolResultIds = new Set<string>()

  for (const block of content) {
    if (isToolUseBlock(block)) {
      toolUseIds.add(block.id)
    }
    if (isToolResultBlock(block)) {
      toolResultIds.add(block.tool_use_id)
    }
  }

  const orphans: ToolUseBlock[] = []
  for (const block of content) {
    if (isToolUseBlock(block) && !toolResultIds.has(block.id)) {
      orphans.push(block)
    }
  }

  return orphans
}

function createPlaceholderToolResult(toolUse: ToolUseBlock): ToolResultBlock {
  return {
    type: "tool_result",
    tool_use_id: toolUse.id,
    content: `Tool ${toolUse.name} was called but no result was provided.`,
    is_error: true,
  }
}

export function repairOrphanToolUses(body: RequestBody): RequestBody {
  const messages = body.messages.map((message) => {
    if (message.role !== "assistant" || typeof message.content === "string") {
      return message
    }
    const orphans = findOrphanToolUses(message.content)
    if (orphans.length === 0) {
      return message
    }
    const newContent = [...message.content]
    for (const orphan of orphans) {
      newContent.push(createPlaceholderToolResult(orphan))
    }
    return { ...message, content: newContent }
  })
  return { ...body, messages }
}
