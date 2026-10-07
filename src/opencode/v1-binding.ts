import { randomUUID } from "node:crypto"

import { NoSuchModelError } from "@ai-sdk/provider"
import { z } from "zod"

import type { HttpTransport } from "../core/http.js"

const OwnerSchema: z.core.$ZodBranded<z.ZodUUID, "V1Owner"> = z.uuid().brand("V1Owner")
const GenerationSchema: z.core.$ZodBranded<z.ZodUUID, "V1Generation"> = z
  .uuid()
  .brand("V1Generation")
export type V1Binding = {
  readonly owner: z.output<typeof OwnerSchema>
  readonly generation: z.output<typeof GenerationSchema>
}
export const V1BindingSchema: z.ZodType<V1Binding> = z
  .object({
    owner: OwnerSchema,
    generation: GenerationSchema,
  })
  .strict()
  .readonly()

export type V1ApiProvider = "claude" | "command-code"
export type V1ModelView = {
  readonly signal: AbortSignal
  readonly transport: HttpTransport
  readonly readAccessToken: (signal: AbortSignal) => Promise<string | null>
  readonly forceRefreshAccessToken: (signal: AbortSignal) => Promise<string | null>
  readonly env: Readonly<Record<string, string | undefined>>
  readonly route: "api" | "subscription"
  readonly readApiKey: (signal: AbortSignal) => Promise<string | null>
}
export type V1BindingOwner = {
  readonly id: V1Binding["owner"]
  readonly bind: (providerId: string, modelId: string, binding: V1Binding) => V1ModelView
}

const owners = new Map<V1Binding["owner"], V1BindingOwner>()

export function newV1OwnerId(): V1Binding["owner"] {
  return OwnerSchema.parse(randomUUID())
}

export function newV1Binding(owner: V1Binding["owner"]): V1Binding {
  return V1BindingSchema.parse({ owner, generation: randomUUID() })
}

export function registerV1Owner(owner: V1BindingOwner): void {
  owners.set(owner.id, owner)
}

export function unregisterV1Owner(owner: V1Binding["owner"]): void {
  owners.delete(owner)
}

export function unavailableV1Model(modelId: string): NoSuchModelError {
  return new NoSuchModelError({ modelId, modelType: "languageModel" })
}

export function resolveV1ModelView(
  value: unknown,
  providerId: string,
  modelId: string,
): V1ModelView {
  const parsed = V1BindingSchema.safeParse(value)
  if (!parsed.success) throw unavailableV1Model(modelId)
  const owner = owners.get(parsed.data.owner)
  if (owner === undefined) throw unavailableV1Model(modelId)
  return owner.bind(providerId, modelId, parsed.data)
}
