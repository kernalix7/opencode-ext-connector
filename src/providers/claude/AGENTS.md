# CLAUDE PROVIDER

Existing Claude Code credentials, Anthropic compatibility transforms, model discovery,
LanguageModelV3 generation, and optional credential persistence.

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
| Tests | `tests/unit/providers/claude/` | Auth, compatibility, stream, refresh, and writeback |

## CONVENTIONS

- Parse credential files and Keychain payloads through `ClaudeCredentials`; malformed sources
  are unavailable, not partially accepted.
- Token refresh stays single-flight. Transient failures use the injected `Clock`; a failed
  refresh may return the still-usable cached access token.
- `CredentialRefreshPolicy` from `core/options` decides refresh: `auto` refreshes `leadMs`
  before expiry; `never` skips the OAuth endpoint entirely and only re-reads the credential
  source on a forced refresh so an externally synced file can take effect.
- No vendor binary is required. Version and credentials are resolved lazily per request so a
  missing `claude` never makes the loader yield the `anthropic` provider back to OpenCode.
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
- Hard-coding a Claude Code version or adding a new mandatory dependency on the `claude` CLI.
- Replacing schema parsing with permissive object access or normalizing malformed credentials.
