import type { Hooks } from "@opencode-ai/plugin"

import type { HttpTransport } from "../../../src/core/http"
import { createV1CatalogProjector } from "../../../src/opencode/v1-catalog"
import { createV1Owner } from "../../../src/opencode/v1-owner"
import { FakeClock } from "../../support/clock"
import { FakeHttpTransport } from "../../support/http"
import { apiTestEntry } from "./api-test-entry"

export const cleanups: (() => Promise<void>)[] = []

export function fixture(keyValue: string, transport: HttpTransport = new FakeHttpTransport()) {
  let key = keyValue
  const clock = new FakeClock()
  const providers = [apiTestEntry()]
  const deps = {
    clock,
    transport,
    env: {},
    allowEnvironmentKeys: false,
    authStore: {
      matchAuth: async (provider: string) =>
        provider === "claude" ? { kind: "api-key" as const, key } : null,
    },
  }
  const projector = createV1CatalogProjector({
    entries: providers,
    npmSpecifiers: { claude: "file:///fixture/claude.js" },
  })
  const config: Parameters<NonNullable<Hooks["config"]>>[0] = {}
  projector.attach(config)
  const owner = createV1Owner({
    entries: providers,
    deps,
    projector,
    lifetime: new AbortController().signal,
    health: { initialBackoffMs: 10_000, maximumBackoffMs: 10_000 },
    snapshotTimeoutMs: 30_000,
    logger: { log: () => undefined },
  })
  cleanups.push(owner.dispose)
  return {
    clock,
    providers,
    deps,
    config,
    owner,
    options: () => config.provider?.["claude"]?.options ?? {},
    setKey: (value: string) => {
      key = value
    },
  }
}
