# CLAUDE PROVIDER

Official Anthropic API-key catalog and Messages generation through SDK 3,
exposing LanguageModelV3 (`@ai-sdk/provider@3.0.18`). Provider/integration ID: `claude`.

## WHERE TO LOOK

| Concern | Location | Contract |
|---------|----------|----------|
| Catalog adapter | `api-adapter.ts` | Key-scoped cached models; key change clears cache; missing key is unavailable |
| Model discovery | `api-models.ts` | Paginated `GET /v1/models`, `x-api-key`; parse IDs; reject missing/repeated continuation cursors |
| Generation | `api-language-model.ts` | Official `/v1/messages` via `@ai-sdk/anthropic`; read API key per generate/stream call; injected transport |
| V1 auth/key lookup | `src/opencode/{auth-store,providers,v1-api-auth}.ts` | Dedicated `claude` API record precedes `ANTHROPIC_API_KEY`; no subscription OAuth/marker reuse |
| V1 account binding | `src/opencode/v1-{binding,owner,generation,language}.ts` | Opaque `connectorV1` binding; pinned key, membership/lifetime checks before requests |
| V2 selected connection | `src/opencode/v2-{auth,refresh,language}.ts` | Host `active` / `resolve` only; key/ID scope reset; per-dispatch revalidation |
| Standalone SDK | `src/sdk/claude.ts` | `./claude` exports `createClaude`; unbound explicit `apiKey` honored |
| Tests | `tests/unit/providers/claude/api-*.test.ts`, `tests/unit/opencode/v1-account-binding.test.ts` | Offline catalog, generation, cancellation, account isolation |

## CONVENTIONS

- Parse official catalog responses at the boundary into branded model IDs; keep keys opaque.
- Keep protocol parsing and SDK request construction in this provider, not core.
- Same-key transient catalog failures can retain stale models; never carry cached models
  across a key change. Cancellation remains cancellation, not stale success.
- V1 bound models use their owner's generation-pinned view. Missing/malformed/retired
  `connectorV1` fails without falling back to standalone or environment credentials.
- V2 has no V1-store or alternative process-env fallback. Retained models must pass current
  connection, generation, membership, and lifetime checks before dispatch.
- No Claude Code credentials, Keychain, credential files, CLI/version discovery,
  compatibility signing, OAuth refresh, authority timer, or writeback path remains.
- Retain SPDX/source notices on files derived from `opencode-claude-auth`.

## ANTI-PATTERNS

- Minting OAuth or treating the connector as a login authority.
- Reusing subscription OAuth/CLI markers as API keys or persisting refreshed credentials.
- Bypassing auth/catalog readiness or reusing a prior account's catalog/model view.
- Replacing schema parsing with permissive object access or normalizing malformed inputs.
