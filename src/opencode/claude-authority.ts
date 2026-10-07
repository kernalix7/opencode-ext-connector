import type { Clock } from "../core/clock.js"
import type { ConnectorLogger } from "../core/logger.js"
import type { CredentialAuthority } from "../core/options.js"
import { createProductionProcessSupervisor } from "../process/production-supervisor.js"
import { type ClaudeAuthLookup, readClaudeCredentials } from "../providers/claude/auth.js"
import { readInstalledClaudeVersion } from "../providers/claude/cli-version.js"
import { createClaudeCredentialAuthorityScheduler } from "../providers/claude/credential-authority-scheduler.js"

export function startClaudeOwnerAuthority(options: {
  readonly authority: CredentialAuthority
  readonly env: Readonly<Record<string, string | undefined>>
  readonly clock: Clock
  readonly logger: ConnectorLogger
  readonly lookup?: ClaudeAuthLookup
}): { readonly dispose: () => Promise<void> } {
  const { claudeCli } = options.authority
  if (!claudeCli.enabled || process.platform !== "linux") return { dispose: async () => undefined }
  const env: Record<string, string> = {}
  for (const name of [
    "HOME",
    "PATH",
    "CLAUDE_CONFIG_DIR",
    "XDG_STATE_HOME",
    "XDG_CONFIG_HOME",
    "LANG",
  ] as const) {
    const value = options.env[name]
    if (value !== undefined) env[name] = value
  }
  const version = readInstalledClaudeVersion(env)
  const parts = version?.split(".").map(Number)
  if (
    parts === undefined ||
    parts.length !== 3 ||
    (parts[0] ?? 0) < 2 ||
    ((parts[0] ?? 0) === 2 &&
      ((parts[1] ?? 0) < 1 || ((parts[1] ?? 0) === 1 && (parts[2] ?? 0) < 265)))
  ) {
    options.logger.log("warn", "claude.authority.unsupported-cli-version", {})
    return { dispose: async () => undefined }
  }
  const supervisor = createProductionProcessSupervisor()
  const scheduler = createClaudeCredentialAuthorityScheduler({
    enabled: true,
    env,
    clock: options.clock,
    logger: options.logger,
    leadMs: claudeCli.leadMs,
    retryMs: claudeCli.retryMs,
    processSupervisor: supervisor,
    readCredentials: (source, signal) => readClaudeCredentials(source, signal, options.lookup),
  })
  return {
    dispose: async () => {
      const results = await Promise.allSettled([scheduler.dispose(), supervisor.dispose()])
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      )
      if (failure !== undefined) throw failure.reason
    },
  }
}
