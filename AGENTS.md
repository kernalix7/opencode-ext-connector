# PROJECT KNOWLEDGE BASE

**Updated:** 2026-10-02
**Code baseline:** `v0.8.0` candidate (official API-key Claude/Command Code, trusted Ollama, retired Cursor/xAI projection, account-scoped generation).
**Candidate:** Based on `origin/main` at `29175e3`; migration is active and unpublished. Final checks, frozen hashes, and four release gates remain pending.

## OVERVIEW

Unofficial OpenCode plugin exposing Claude and Command Code official APIs plus
a trusted Ollama daemon from one `opencode.json` entry. Claude and Command Code
use API keys; Cursor is unsupported and xAI OAuth projection is retired. Source is
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
src/providers/claude/          api-* catalog/adapter/language modules; see AGENTS.md
src/providers/command-code/    api-* catalog and supported-endpoint dispatch
src/providers/cursor/          retirement knowledge document only; SDK stub in src/sdk/
src/providers/ollama/          trusted daemon endpoints and catalog runtime; see AGENTS.md
src/providers/xai/             retirement knowledge document only
src/process/                   production child-process supervision and disposal
src/{catalog,http,logging}/    small shared boundary implementations
src/sdk/                       claude, command-code, ollama SDKs; cursor retirement stub
src/xai.ts                     dedicated `/xai` retirement entry
src/v2-entry/server.ts         compiled directory loader forwarding to V2
scripts/                       build, source-policy, and pure-LOC checks
tests/                         unit/integration/e2e suites and fakes; see AGENTS.md
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Public plugin exports | `src/index.ts` | Exactly six named V1 functions; Cursor/xAI auth exports are inert. `./server` aliases this entry. |
| V2 plugin entry | `src/v2.ts` | Default export only; V2 imports stay in `beta-api.ts`. CLI 2.0.20 config loads the built `dist/v2-entry` directory (`server.js`), not a direct file URL. Root and `./server` remain V1-only; `./v2` is the V2 Node import entry, not a config package spec. Candidate pending audits. No V2 xAI integration. |
| Server composition | `src/server.ts` | Registry, transports, auth servers, disposal |
| Shared contracts | `src/core/AGENTS.md` | No provider protocol or concrete I/O |
| OpenCode integration | `src/opencode/` | V1 API boundary; actual V2 imports stay in `beta-api.ts` |
| Claude changes | `src/providers/claude/AGENTS.md` | Official Models/Messages APIs and API-key generation |
| Process supervision | `src/process/production-supervisor.ts` | Spawn, abort, termination, and process cleanup |
| Cursor retirement | `src/sdk/cursor.ts` | `languageModel()` throws `CursorRetiredError` |
| Ollama changes | `src/providers/ollama/AGENTS.md` | Local/Cloud catalog and configured-daemon generation |
| Command Code changes | `src/providers/command-code/api-*.ts` | Official catalog and chat/messages/responses routes |
| xAI retirement | `src/xai.ts`, `src/providers/xai/AGENTS.md` | Dedicated entry throws `XaiOAuthRetiredError`; native xAI keys are outside this connector |
| V1 account binding | `src/opencode/v1-{binding,owner,generation,language,catalog}.ts` | Opaque binding, key-pinned generation, request revalidation |
| V2 account scope | `src/opencode/v2-{auth,refresh,catalog,language}.ts` | Selected connection, scope rotation, per-dispatch checks |
| V2 SDK bootstrap | `src/opencode/v2-sdk.ts` | Required no-I/O factory before host hooks; fallback models fail closed |
| Test placement | `tests/AGENTS.md` | Deterministic fakes and isolated E2E |
| Policy failures | `scripts/check-source-policy.ts` | AST/source-boundary violations |
| Size failures | `scripts/check-file-size.ts` | 250 pure-LOC ceiling |

## CONNECTION MODEL

- `providers` defaults to `claude`, `command-code`, and `ollama`; explicit `[]`
  disables all. `cursor` is rejected by the options schema.
- Public root exports are exactly `connectorServer`, `claudeAuthServer`,
  `cursorAuthServer`, `commandCodeAuthServer`, `ollamaAuthServer`, and
  `xaiAuthServer`.
- `src/opencode/providers.ts` owns cross-provider registration; protocol code
  stays inside its provider directory.
- V1 Claude/Command Code use their dedicated `claude` / `command-code` API
  records, then `ANTHROPIC_API_KEY` / `COMMAND_CODE_API_KEY` when no match exists.
  OAuth and CLI-session markers are not API keys. Claude's integration ID is
  `claude`, not `anthropic`. Ollama requires its exact marker and responsive daemon.
- Claude uses `/v1/models` and `/v1/messages`. Command Code uses
  `/provider/v1/models` and advertised `supported_endpoints` for
  `/provider/v1/chat/completions`, `/provider/v1/messages`, or `/provider/v1/responses`.
  No guessed model IDs, vendor CLI, subscription credential files, CLI identity,
  private NDJSON/protobuf, authority scheduler, OAuth refresh, or writeback.
- `credentialRole`, `credentialManagement`, `credentialAuthority`,
  `credentialRefresh`, `writeBackCredentials`, and `xaiOAuth` reject whenever
  present, even alone or disabled; none remains an active policy option.
- Root Cursor/xAI auth functions return empty hooks. The Cursor SDK rejects
  generation; the dedicated `/xai` entry rejects loading. Use native OpenCode
  xAI API keys outside this connector.
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
- Ordinary hosts and sandbox guests both use API keys available to their own
  OpenCode runtime and writable protected auth storage. Subscription credential
  mounts are not used. Guest Ollama needs an explicit reachable host route when
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
