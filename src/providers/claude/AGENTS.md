# CLAUDE PROVIDER

Existing Claude Code credentials, Anthropic compatibility transforms, model discovery,
LanguageModelV3 generation, and optional credential persistence.

## WHERE TO LOOK

| Concern | Location | Contract |
|---------|----------|----------|
| Credential schema | `credentials.ts` | Parse the Claude OAuth blob; keep tokens opaque |
| Credential lookup | `auth.ts` | macOS Keychain first, then `CLAUDE_CONFIG_DIR` file |
| Token refresh | `refresh.ts`, `auth.ts` | Single in-flight refresh with clock-based retry backoff |
| CLI metadata | `cli-version.ts` | Required for compatibility catalog requests |
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
- Sending compatibility requests without the required CLI metadata and token state.
- Replacing schema parsing with permissive object access or normalizing malformed credentials.
