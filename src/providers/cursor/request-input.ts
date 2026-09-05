import { z } from "zod"

import { type ModelId, ModelIdSchema } from "../../core/ids.js"
import type { McpToolDefinition } from "./proto/mcp.js"
import type { RequestedModelParameter } from "./proto/model.js"
import { type CursorSessionId, CursorSessionIdSchema } from "./session-state.js"

type CursorJson =
  | string
  | number
  | boolean
  | null
  | readonly CursorJson[]
  | { readonly [key: string]: CursorJson }

export type CursorRunImage = {
  readonly data: Uint8Array
  readonly mimeType: string
}

export type CursorRunMessage = {
  readonly text: string
  readonly images: readonly CursorRunImage[]
  readonly selectedContext?: readonly string[] | undefined
}

export type CursorRunResultContent =
  | { readonly kind: "text"; readonly text: string }
  | (CursorRunImage & { readonly kind: "image" })

export type CursorRunToolResult =
  | {
      readonly kind: "success"
      readonly content: readonly CursorRunResultContent[]
    }
  | { readonly kind: "error"; readonly error: string }

export type CursorRunStep =
  | { readonly kind: "assistant"; readonly text: string }
  | { readonly kind: "thinking"; readonly text: string }
  | {
      readonly kind: "tool"
      readonly arguments: Readonly<Record<string, CursorJson>>
      readonly result?: CursorRunToolResult | undefined
      readonly toolCallId: string
      readonly toolName: string
    }

export type CursorRunTurn = {
  readonly user: CursorRunMessage
  readonly steps: readonly CursorRunStep[]
}

type CursorRunBase = {
  readonly conversationId: CursorSessionId
  readonly history: readonly CursorRunTurn[]
  readonly maxMode?: boolean | undefined
  readonly mcpTools: readonly McpToolDefinition[]
  readonly modelId: ModelId
  readonly modelParameters: readonly RequestedModelParameter[]
  readonly refreshRootPrompt?: boolean | undefined
  readonly rootSystemPrompt: string
}

type CursorUserAction = CursorRunMessage & { readonly kind: "user" }

export type CursorRunBuildInput =
  | (CursorRunBase & { readonly mode: "fresh"; readonly action: CursorUserAction })
  | (CursorRunBase & {
      readonly mode: "checkpoint"
      readonly sessionId: CursorSessionId
      readonly action: CursorUserAction | { readonly kind: "resume" } | { readonly kind: "cancel" }
    })

const BytesSchema: z.ZodType<Uint8Array> = z.instanceof(Uint8Array)
const ImageSchema: z.ZodType<CursorRunImage> = z
  .object({ data: BytesSchema, mimeType: z.string().min(1).max(256) })
  .strict()
  .readonly()
const SelectedContextSchema: z.ZodType<readonly string[]> = z
  .array(z.string().min(1))
  .max(128)
  .readonly()
const MessageSchema: z.ZodType<CursorRunMessage> = z
  .object({
    text: z.string(),
    images: z.array(ImageSchema).max(32).readonly(),
    selectedContext: SelectedContextSchema.optional(),
  })
  .strict()
  .readonly()
const ResultContentSchema: z.ZodType<CursorRunResultContent> = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("text"), text: z.string() })
    .strict()
    .readonly(),
  z
    .object({ kind: z.literal("image"), data: BytesSchema, mimeType: z.string().min(1) })
    .strict()
    .readonly(),
])
const ToolResultSchema: z.ZodType<CursorRunToolResult> = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("success"), content: z.array(ResultContentSchema).readonly() })
    .strict()
    .readonly(),
  z
    .object({ kind: z.literal("error"), error: z.string() })
    .strict()
    .readonly(),
])
const StepSchema: z.ZodType<CursorRunStep> = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("assistant"), text: z.string() })
    .strict()
    .readonly(),
  z
    .object({ kind: z.literal("thinking"), text: z.string() })
    .strict()
    .readonly(),
  z
    .object({
      kind: z.literal("tool"),
      arguments: z.record(z.string(), z.json()),
      result: ToolResultSchema.optional(),
      toolCallId: z.string().min(1),
      toolName: z.string().min(1),
    })
    .strict()
    .readonly(),
])
const TurnSchema: z.ZodType<CursorRunTurn> = z
  .object({ user: MessageSchema, steps: z.array(StepSchema).readonly() })
  .strict()
  .readonly()
const McpToolSchema: z.ZodType<McpToolDefinition> = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    inputSchema: z.json(),
    providerIdentifier: z.string().min(1),
    toolName: z.string().min(1),
  })
  .strict()
  .readonly()
const UserActionSchema: z.ZodType<CursorUserAction> = z
  .object({
    kind: z.literal("user"),
    text: z.string(),
    images: z.array(ImageSchema).max(32).readonly(),
    selectedContext: SelectedContextSchema.optional(),
  })
  .strict()
  .readonly()
const BaseShape = {
  conversationId: CursorSessionIdSchema,
  history: z.array(TurnSchema).readonly(),
  maxMode: z.boolean().optional(),
  mcpTools: z.array(McpToolSchema).readonly(),
  modelId: ModelIdSchema,
  modelParameters: z
    .array(z.object({ id: z.string(), value: z.string() }).strict().readonly())
    .readonly(),
  refreshRootPrompt: z.boolean().optional(),
  rootSystemPrompt: z.string(),
}

export const CursorRunBuildInputSchema: z.ZodType<CursorRunBuildInput> = z.discriminatedUnion(
  "mode",
  [
    z
      .object({ ...BaseShape, mode: z.literal("fresh"), action: UserActionSchema })
      .strict()
      .readonly(),
    z
      .object({
        ...BaseShape,
        mode: z.literal("checkpoint"),
        sessionId: CursorSessionIdSchema,
        action: z.union([
          UserActionSchema,
          z
            .object({ kind: z.literal("resume") })
            .strict()
            .readonly(),
          z
            .object({ kind: z.literal("cancel") })
            .strict()
            .readonly(),
        ]),
      })
      .strict()
      .readonly(),
  ],
)

export function parseCursorRunBuildInput(input: unknown): CursorRunBuildInput {
  return CursorRunBuildInputSchema.parse(input)
}
