import { randomUUID } from "node:crypto"
import { z } from "zod"

const sessionIdSchema: z.core.$ZodBranded<z.ZodString, "CommandCodeSessionId"> = z
  .string()
  .uuid()
  .brand<"CommandCodeSessionId">()
export type CommandCodeSessionId = z.infer<typeof sessionIdSchema>
export function createCommandCodeSessionId(
  generate: () => string = randomUUID,
): CommandCodeSessionId {
  return sessionIdSchema.parse(generate())
}
