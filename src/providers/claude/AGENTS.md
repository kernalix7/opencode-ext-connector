# CLAUDE PROVIDER

Existing Claude Code credential catalog and compatibility Messages generation through
SDK 3, exposing LanguageModelV3 (`@ai-sdk/provider@3.0.18`). Provider `claude`,
subscription integration `anthropic`; standalone API-key SDK is separate.

Corrective 0.9 restores readers, lineage-aware lifecycle and published v0.7.1
behavior inside scoped V1/V2 generation. Verification uses synthetic credentials
and actual host surfaces, not live vendor acceptance or permission.

## WHERE TO LOOK

| Concern | Location | Contract |
|---------|----------|----------|
| Credential reader | `auth.ts`, `credentials.ts` | Keychain-first, file fallback, complete OAuth parsing, source observation and cancellation |
| Credential manager | `token-manager.ts`, `refresh.ts`, `writeback.ts` | Policy-gated singleflight refresh, source/lineage revalidation, explicit writeback and disposal |
| Catalog | `adapter.ts`, `models.ts` | Bearer discovery, dynamic version and scoped cache |
| Generation | `subscription-language-model.ts`, `compat-*.ts` | SDK authToken, published transforms and guarded transport beneath every attempt |
| Optional API SDK | `api-*.ts` | Explicit standalone API-key contracts only; never default fallback |
| V1 native auth | `src/opencode/v1-claude-{auth,loader}.ts` | Exact selected gate before renewal/dispatch, scoped lifetime and membership |
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
- Reuse necessary published compatibility behavior without adding new identity,
  signing, evasion or OAuth/login mechanisms. Existing short billing hashes have not
  been established as authentication signatures or an inspected access-control bypass.
  Preserve unofficial public branding and report service-support/terms risks accurately.
- Inject guarded transport beneath every compatibility attempt/retry; do not let
  a direct global fetch bypass current scope, membership, lifetime or cancellation checks.
- Scope continuity is established only for connector-observed refresh descendants of
  the still-current source. Unknown external replacement revokes old views rather
  than silently replaying their prompts under another account. Missing sources clear caches.
- Retain SPDX/source notices on files derived from `opencode-claude-auth`.

## ANTI-PATTERNS

- Minting OAuth or treating the connector as a login authority.
- Treating connection markers as vendor credentials or persisting refreshed
  credentials without the normalized writeback capability.
- Bypassing auth/catalog readiness or reusing a prior account's catalog/model view.
- Replacing schema parsing with permissive object access or normalizing malformed inputs.
