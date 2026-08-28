import { randomUUID } from "node:crypto"

import { z } from "zod"

const commandCodeSessionIdSchema: z.core.$ZodBranded<z.ZodString, "CommandCodeSessionId"> = z
  .string()
  .uuid()
  .brand<"CommandCodeSessionId">()

export type CommandCodeSessionId = z.infer<typeof commandCodeSessionIdSchema>

export function createCommandCodeSessionId(
  generate: () => string = randomUUID,
): CommandCodeSessionId {
  return commandCodeSessionIdSchema.parse(generate())
}
