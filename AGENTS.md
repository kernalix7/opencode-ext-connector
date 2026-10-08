# PROJECT KNOWLEDGE BASE

**Updated:** 2026-10-08
**Code baseline:** `v0.9.1` restored V1 xAI consumer and authority observer; V2 consumer explicitly rejected before allocation. Existing Claude/Command Code credentials, scoped generation, trusted Ollama and Cursor exclusion retained.
**Candidate:** `/workspace/project/.omo/artifacts/release-v091/candidate`, branch `release/v0.9.1-xai`, based on published `0fc41ff` (0.9.0) and immutable `v0.7.1` (`29175e3`). Support boundary is finalized: the original xAI consumer is V1-only, not a V2 session extension. Parent's check and 758-pass/0-fail suite predate the boundary correction. Built root/dedicated consumer and production-supervised synthetic-helper initial/change/removal QA passed on Bun 1.3.14/Node 24.20.0, without live vendors. Parent still owns corrected full-suite gates, final source freeze, fresh packed manifest, gate review, exact-commit CI/OIDC publication and registry verification; no final approval or publication is recorded here.

## OVERVIEW

Unofficial OpenCode plugin reusing existing Claude Code and Command Code credentials
plus a trusted Ollama daemon from one `opencode.json` entry. Standalone API-key SDK
use is separate and explicit; Cursor is unsupported and xAI OAuth projection is independently opt-in. Source is
BSD-3-Clause; third-party access and terms remain the user's responsibility.

Stack: Bun 1.3.14, TypeScript 6.0.2 strict, Zod 4.1.8,
`@opencode-ai/plugin@1.18.18`, `@opencode/plugin@2.0.20`, and
`@ai-sdk/provider@3.0.18` LanguageModelV3 with Anthropic/OpenAI SDK 3 adapters.

## STRUCTURE

```text
src/index.ts                   public legacy-loader exports
src/v2.ts                      V2 default export; does not replace the six root functions
src/server.ts                  catalog/auth composition and process-level dependencies
src/core/                      frozen provider-agnostic contracts; see AGENTS.md
src/opencode/                  auth store, registry, V1 hooks, catalog/language wiring
src/providers/claude/          credentials, compatibility and optional api-* SDK modules
src/providers/command-code/    CLI credential/NDJSON protocol and optional api-* SDK modules
src/providers/cursor/          retirement knowledge document only; SDK stub in src/sdk/
src/providers/ollama/          trusted daemon endpoints and catalog runtime; see AGENTS.md
src/providers/xai/             secure access state, consumer and authority observation
src/process/                   production child-process supervision and disposal
src/{catalog,http,logging}/    small shared boundary implementations
src/sdk/                       claude, command-code, ollama SDKs; cursor retirement stub
src/xai.ts                     dedicated `/xai` consumer entry
src/v2-entry/server.ts         compiled directory loader forwarding to V2
scripts/                       build, source-policy, and pure-LOC checks
tests/                         unit/integration/e2e suites and fakes; see AGENTS.md
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Public plugin exports | `src/index.ts` | Exactly six named V1 functions; Cursor stays inert, xAI consumer is restored under opt-in mode. `./server` aliases this entry. |
| V2 plugin entry | `src/v2.ts` | Default export only; V2 imports stay in `beta-api.ts`. CLI 2.0.20 config loads `dist/v2-entry` (`server.js`), not a direct file URL. Root/server stay V1-only; `./v2` is a Node import. Reject xAI consumer setup with a typed error before allocation; authority observes selected active/resolve. |
| Server composition | `src/server.ts` | Registry, transports, auth servers, disposal |
| Shared contracts | `src/core/AGENTS.md` | No provider protocol or concrete I/O |
| OpenCode integration | `src/opencode/` | V1 API boundary; actual V2 imports stay in `beta-api.ts` |
| Claude changes | `src/providers/claude/AGENTS.md` | Existing OAuth source, lineage-aware lifecycle and scoped compatibility generation |
| Process supervision | `src/process/production-supervisor.ts` | Spawn, abort, termination, and process cleanup |
| Cursor retirement | `src/sdk/cursor.ts` | `languageModel()` throws `CursorRetiredError` |
| Ollama changes | `src/providers/ollama/AGENTS.md` | Local/Cloud catalog and configured-daemon generation |
| Command Code changes | `src/providers/command-code/` | Existing CLI catalog and `/alpha/generate`; api-* is optional SDK only |
| xAI restoration | `src/xai.ts`, `src/providers/xai/AGENTS.md` | Dedicated entry exposes only `xaiAuthServer`; secure access-only projection, exact marker, empty login methods and external helper observation |
| V1 account binding | `src/opencode/v1-{binding,owner,generation,language,catalog}.ts` | Opaque binding, key-pinned generation, request revalidation |
| V2 account scope | `src/opencode/v2-{auth,refresh,catalog,language}.ts` | Selected connection, scope rotation, per-dispatch checks |
| V2 SDK bootstrap | `src/opencode/v2-sdk.ts` | Required no-I/O factory before host hooks; fallback models fail closed |
| Test placement | `tests/AGENTS.md` | Deterministic fakes and isolated E2E |
| Policy failures | `scripts/check-source-policy.ts` | AST/source-boundary violations |
| Size failures | `scripts/check-file-size.ts` | 250 pure-LOC ceiling |

## CONNECTION MODEL

- `providers` defaults to `claude`, `command-code`, and `ollama`; explicit `[]`
  disables those three. `cursor` and `xai` are rejected as list members.
- Independent strict `xaiOAuth: { mode: "authority" | "consumer" }` is restored.
  Omission/undefined disables it (normalized null); literal null, invalid/missing
  mode and extra keys reject. It does not change Claude policy constraints.
- Public root exports are exactly `connectorServer`, `claudeAuthServer`,
  `cursorAuthServer`, `commandCodeAuthServer`, `ollamaAuthServer`, and
  `xaiAuthServer`.
- `src/opencode/providers.ts` owns cross-provider registration; protocol code
  stays inside its provider directory.
- V1 Claude uses the existing `anthropic` OAuth record or exact session marker
  plus its vendor source; provider id is `claude`, integration id is `anthropic`.
  Command Code uses its exact marker plus existing source or selected direct key.
  Markers are not outbound tokens; missing sessions never trigger paid API fallback.
- Default Claude uses bearer Models/Messages with published compatibility metadata.
  Default Command Code uses its bearer catalog and provider-local `/alpha/generate`
  NDJSON. Dynamic versions resolve from override, optional binary, then npm.
  No vendor generation CLI is required by default; owner authority is separate.
- The connector accepts and normalizes `credentialRole`,
  `credentialManagement`, `credentialAuthority`, `credentialRefresh`, and
  `writeBackCredentials`. Policies are wired to the shared per-scope Claude manager;
  writeback requires explicit capability. xAI authority/consumer is independent.
- Restore necessary published protocol compatibility inside the current account,
  membership and lifetime boundaries, not by reverting unscoped host loaders.
  No inspected source established authentication-signature forgery or an access-control
  bypass. Do not add new evasion/identity/signature mechanisms or advertise an
  unverified neutral protocol. Lack of official support is not proof that source
  restoration is technically impossible, and licensed source grants no service permission.
- Preserve existing-credential/no-required-native-generation-CLI/no-paid-fallback
  conditions. Optional standalone API SDKs remain a separate explicitly selected path.
  Managed refresh descendants may retain scope only while the source/gate is current;
  unknown external credential/source replacement must revoke captured views.
- Root Cursor remains inert and its SDK rejects generation. Root/dedicated xAI
  consumer requires the exact V1 API marker `cli-session:xai`; sentinel
  `xai-access-file` is not a credential and `methods: []` adds no login.
- xAI fresh requests reread secure owned single-link 0600 closed-v1 access-only
  projection. Pending attempts retain original source/token/expiry/gate/lifetime
  and block observed drift; targets/cancellation/disposal are rechecked and redirects
  rejected. Fresh A-to-B rotation through one loader is supported. No 401
  prompt replay, new grants, connector refresh or paid API fallback.
- xAI authority observes existing changes and invokes fixed HOME/.local/bin/
  opensandbox-xai-auth-sync with no args and sanitized HOME/PATH/absolute XDG,
  polling/retry and disposal. The external manager owns projection, not a package
  writer or secret mirror; no guest refresh token. The actual helper is absent in
  this environment and is neither bundled nor installed.
- Native CLI 2.0.20 `/api/experimental/generate` bypasses all session hooks;
  nativeModelResolver ignores SDK hooks and exposes no auth-factory interceptor.
  V2 consumer mode is unsupported and must fail with a typed setup error before
  allocation, not an unsafe session extension. Do not claim native HTTP/WebSocket
  interception or global fail-closed native API enforcement. Independent native
  xAI API-key use and other V2 providers are unchanged when consumer opt-in is unset.
- V2 authority uses selected active/resolve, including removal into stable absence,
  not V1 auth storage or unselected-env fallback. External manager compatibility
  with that native V2 source remains unverified; it owns projection independently.
- V1 `connectorV1` is private opaque owner/generation nonce metadata, not a user
  option or credential. Key changes retire the old adapter/catalog/health scope;
  generation-pinned model views revalidate effective key, current generation,
  membership, and lifetime before requests. Disposal revokes bindings.
  Malformed/unknown bound options fail without standalone fallback. Standalone
  Claude/Command Code SDKs honor explicit `apiKey` when unbound.
- V2 uses only the selected host connection's `active` / `resolve` result;
  no V1 auth store or alternative process-env key fallback. Key/connection-ID
  changes reset catalog, health, and adapters. Language dispatch checks
  generation, membership, connection, and lifetime, including each transport call.
- `v2-sdk.ts` remains the required CLI 2.0.20 bootstrap; scoped hooks provide
  language models and bootstrap fallbacks fail closed.
- Provider snapshots, health, and failures remain isolated.
- `ollamaBaseURL` is a flat connector and standalone SDK option. It defaults to
  `http://localhost:11434`; explicit remote/self-hosted bases preserve path
  prefixes and are normalized for Ollama state. Do not add it to core options.
- Ordinary hosts and guests reuse credential sources available to their own runtime.
  Shared readers use externally managed, read-only sources and separate protected
  writable OpenCode auth storage. Guest Ollama needs an explicit reachable host route when
  guest `localhost` is not the daemon host; daemon-side Cloud login stays separate.

## WORKSPACE HANDOFF

- Keep release candidates isolated from the canonical dirty workspace.
- Preserve the canonical dirty root and source-audit evidence; candidate work
  does not authorize overwriting either.
- `.opensandbox/project-id` and `sandbox.sh` are ignored local runner state. Keep
  them unless the user explicitly asks to remove OpenSandbox tooling.
- Ignored recovery snapshots are local state, not project source.
- Remote feature branches were intentionally left untouched.

## CONVENTIONS

- Bun only; do not add npm/pnpm lockfiles.
- Strict exported types; no `any`, type assertions, non-null assertions,
  TypeScript suppressions, or enums.
- Default exports are lint-forbidden except at the `src/index.ts`,
  `src/server.ts`, and `src/v2.ts` loader boundaries.
- Create branded IDs only through their Zod parsers.
- Provider directories never import sibling providers.
- `src/logging/logger.ts` is the only console-call boundary.
- `src/opencode/beta-api.ts` is the only OpenCode V2 import boundary.
  `src/v2.ts` imports V2 types from there, not from `@opencode/plugin` directly.
- Core time uses injected `Clock`.
- Every TypeScript file stays at or below 250 pure LOC.
- Derived files carry an SPDX/source header pointing to
  `THIRD_PARTY_NOTICES.md`.

## ANTI-PATTERNS

- Do not mix provider parsers, credentials, or protocol fallback into core.
- Do not log credentials or move console calls outside the logging boundary.
- Do not bypass provider auth/catalog readiness.
- Do not read `OLLAMA_HOST` or add Ollama credentials, custom headers, redirect
  following, custom CA handling, or TLS bypass.

## COMMANDS

```bash
bun run check
bun run build
bun test
bun run test:provider
bun run test:integration
bun run test:e2e
OPENCODE_V2_BIN=/path/to/v2-binary bun run test:e2e:v2
bun run verify:package
```

`bun run check` runs Biome, TypeScript, source policy, pure-LOC policy, and the
policy foundation tests. `bun run verify:package` is a dry-run package pack.
`build` cleans `dist` and compiles public entry roots and their dependencies,
including `dist/v2-entry` and the required `v2-sdk` bootstrap. Unreachable
legacy helpers are not emitted; there is no HTTP/2 bridge build step.
Default `bun test` skips the V2 lane when the private binary is absent. The
explicit lane does not. See `tests/AGENTS.md`.

## RELEASE

- `.github/workflows/release.yml` publishes to npm when a `v*` tag is pushed
  and fails if the tag differs from `package.json`.
- Configure npm trusted publishing for this repository and `release.yml` before
  tagging; releases use GitHub Actions OIDC and must not use `NPM_TOKEN` or
  token-bearing `.npmrc` configuration.
- Bump `package.json`, both READMEs, `CHANGELOG.md`, and
  `tests/unit/index/package-export.test.ts` together.
- Candidate evidence must use new frozen hashes and complete all four release
  gates before release approval; this knowledge update does not claim those gates passed.

## SAFETY

- Do not claim affiliation with OpenCode or any provider.
- Do not describe unpublished provider protocols as public APIs.
- Do not mint OAuth, bypass access controls, or infer service permission from
  this repository's license.
- Preserve the English/Korean disclaimer meaning; `LICENSE` controls on conflict.
- Never reset, checkout, stash, or revert unrelated dirty-worktree changes.
