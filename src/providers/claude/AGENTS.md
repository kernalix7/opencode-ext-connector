# CLAUDE PROVIDER

Existing Claude Code credentials, Anthropic compatibility transforms, model discovery,
LanguageModelV3 generation, optional credential persistence, and opt-in CLI authority.

## WHERE TO LOOK

| Concern | Location | Contract |
|---------|----------|----------|
| Credential schema | `credentials.ts` | Parse the Claude OAuth blob; keep tokens opaque |
| Credential lookup | `auth.ts` | macOS Keychain first, then `CLAUDE_CONFIG_DIR` file |
| Token refresh | `refresh.ts`, `auth.ts` | Single in-flight refresh with clock-based retry backoff |
| Client version | `cli-version.ts` | `ANTHROPIC_CLI_VERSION`, then an installed binary, then the npm registry; never a constant |
| Catalog | `adapter.ts`, `models.ts` | No credentials/version means no published models |
| OpenCode compatibility | `compat-request.ts`, `compat-*.ts` | Request headers/body and response transforms |
| Direct language model | `language-model.ts`, `prompt.ts` | V3 generate/stream over Anthropic messages |
| SSE stream | `sse.ts`, `sse-convert.ts`, `emit-stream.ts` | Provider-local event parsing and V3 emission |
| Credential persistence | `writeback.ts`, `auth-json.ts`, `atomic-private-file.ts` | Files, OpenCode auth, and macOS Keychain |
| CLI credential authority | `credential-authority-scheduler.ts` | Linux-only expiry scheduling, shared `flock`, retry, and disposal |
| Tests | `tests/unit/providers/claude/` | Auth, compatibility, stream, refresh, and writeback |

## CONVENTIONS

- Parse credential files and Keychain payloads through `ClaudeCredentials`; malformed sources
  are unavailable, not partially accepted.
- Token refresh stays single-flight. Transient failures use the injected `Clock`; a failed
  refresh may return the still-usable cached access token.
- `CredentialRefreshPolicy` from `core/options` decides refresh: `auto` refreshes `leadMs`
  before expiry; `never` skips the OAuth endpoint entirely and only re-reads the credential
  source on a forced refresh so an externally synced file can take effect.
- No vendor binary is required unless the CLI authority is explicitly enabled. Normal version
  and credential lookup stays lazy, so a missing `claude` never yields the `anthropic` provider
  back to OpenCode.
- CLI authority requires external credential management, Linux, util-linux `flock`, and Claude
  Code >=2.1.259. It schedules one restricted single-turn request, treats lock exit `75` as silent
  contention, retries transient failures, and never owns OAuth or credential writes.
- Keep production spawning in `src/process/production-supervisor.ts` and compose/dispose the
  scheduler only from `connectorServer`; standalone auth servers do not start it.
- `src/opencode/v1-anthropic-auth.ts` is the host-facing compatibility hook;
  request/response protocol transforms remain in this directory.
- Keep compatibility metadata, beta selection, model override, and signing in the existing
  `compat-*` modules rather than folding them into transport or core.
- Streaming converts Anthropic SSE into LanguageModelV3 parts inside this provider.
- Writeback is injected only when `writeBackCredentials` is enabled. Preserve unrelated JSON
  fields and refuse compare-and-swap updates when the prior token changed.
- Retain SPDX/source notices on files derived from `opencode-claude-auth`.

## ANTI-PATTERNS

- Minting OAuth or treating the connector as a login authority.
- Persisting refreshed credentials when writeback is disabled.
- Sending compatibility requests without a resolved client version and token state.
- Hard-coding a Claude Code version or making the optional `claude` CLI path mandatory.
- Starting authority scheduling from standalone auth servers or bypassing process-shared locking.
- Replacing schema parsing with permissive object access or normalizing malformed credentials.
