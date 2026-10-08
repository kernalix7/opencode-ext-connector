import { createHash } from "node:crypto"

import type { Clock } from "../core/clock.js"
import type { ProcessSupervisor } from "../core/process.js"
import { createProductionProcessSupervisor } from "../process/production-supervisor.js"
import { createXaiAuthorityObserver } from "../providers/xai/authority-observer.js"
import type { V2ConnectionSource } from "./v2-auth.js"
import { observeXaiSelected } from "./v2-xai-source.js"

export class XaiV2ConsumerUnsupportedError extends Error {
  public override readonly name = "XaiV2ConsumerUnsupportedError"
  public readonly code = "XAI_V2_CONSUMER_UNSUPPORTED"

  public constructor() {
    super(
      "xAI projected consumer is unsupported in OpenCode V2; use the V1 plugin consumer instead",
    )
  }
}

export type V2XaiOptions = {
  readonly connection: V2ConnectionSource
  readonly env: Readonly<Record<string, string | undefined>>
  readonly clock: Clock
  readonly createSupervisor?: () => ProcessSupervisor
}

export async function registerV2Xai(options: V2XaiOptions): Promise<() => Promise<void>> {
  const supervisor = options.createSupervisor?.() ?? createProductionProcessSupervisor()
  try {
    const observer = createXaiAuthorityObserver({
      enabled: true,
      clock: options.clock,
      env: options.env,
      processSupervisor: supervisor,
      observeSource: async () => {
        const selected = await observeXaiSelected(options.connection)
        if (selected === null)
          return {
            kind: "ready",
            fingerprint: createHash("sha256").update("null").digest("hex"),
          }
        const digest = createHash("sha256")
          .update(selected.identity)
          .update(selected.fingerprint)
          .digest("hex")
        return { kind: "ready", fingerprint: digest }
      },
    })
    return async () => {
      const results = await Promise.allSettled([observer.dispose(), supervisor.dispose()])
      const failures = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      )
      if (failures.length > 0) throw new AggregateError(failures, "xAI V2 authority cleanup failed")
    }
  } catch (error: unknown) {
    await Promise.allSettled([supervisor.dispose()])
    throw error
  }
}
