import { z } from "zod"

type OllamaJson =
  | boolean
  | null
  | number
  | string
  | readonly OllamaJson[]
  | { readonly [key: string]: OllamaJson }

const JsonObjectSchema: z.ZodType<Record<string, OllamaJson>> = z.record(z.string(), z.json())

export type OllamaPullChunk = {
  readonly status?: string | undefined
  readonly error?: string | undefined
}

export const OllamaPullChunkSchema: z.ZodType<OllamaPullChunk> = z
  .object({ status: z.string().optional(), error: z.string().optional() })
  .readonly()

type OllamaToolCall = {
  readonly function: {
    readonly name: string
    readonly arguments: Record<string, OllamaJson>
  }
}

const OllamaToolCallSchema: z.ZodType<OllamaToolCall> = z
  .object({
    function: z.object({ name: z.string().min(1), arguments: JsonObjectSchema }),
  })
  .readonly()

export type OllamaChatChunk = {
  readonly message: {
    readonly role?: string | undefined
    readonly content: string
    readonly thinking?: string | undefined
    readonly tool_calls?: readonly OllamaToolCall[] | undefined
  }
  readonly done: boolean
  readonly done_reason?: string | undefined
  readonly prompt_eval_count?: number | undefined
  readonly eval_count?: number | undefined
}

export const OllamaChatChunkSchema: z.ZodType<OllamaChatChunk> = z
  .object({
    message: z
      .object({
        role: z.string().optional(),
        content: z.string().default(""),
        thinking: z.string().optional(),
        tool_calls: z.array(OllamaToolCallSchema).optional(),
      })
      .readonly(),
    done: z.boolean(),
    done_reason: z.string().optional(),
    prompt_eval_count: z.number().int().nonnegative().optional(),
    eval_count: z.number().int().nonnegative().optional(),
  })
  .readonly()

export type OllamaMessage = {
  readonly role: "assistant" | "system" | "tool" | "user"
  readonly content: string
  readonly thinking?: string
  readonly tool_name?: string
  readonly tool_calls?: readonly {
    readonly function: {
      readonly name: string
      readonly arguments: Readonly<Record<string, unknown>>
    }
  }[]
}

export type OllamaChatRequest = {
  readonly model: string
  readonly stream: true
  readonly messages: readonly OllamaMessage[]
  readonly tools?: readonly {
    readonly type: "function"
    readonly function: {
      readonly name: string
      readonly description: string
      readonly parameters: object
    }
  }[]
  readonly format?: object | "json"
  readonly options?: Readonly<Record<string, number | readonly string[]>>
}
