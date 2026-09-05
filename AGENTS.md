# PROJECT KNOWLEDGE BASE

**Updated:** 2026-08-30
**Commit:** 62518cb
**Branch:** `main`; preserve the existing dirty worktree

## OVERVIEW

Unofficial OpenCode plugin exposing Claude, Cursor, Command Code, and Ollama from
one `opencode.json` entry. It reuses existing vendor sessions and never mints
OAuth. Source is BSD-3-Clause; third-party access and terms remain the user's
responsibility.

Stack: Bun 1.3.14, TypeScript 6.0.2 strict, Zod 4.1.8,
`@opencode-ai/plugin@1.18.18`, and `@ai-sdk/provider@3.0.8` LanguageModelV3.
Cursor direct generation additionally requires Node >=22.

## STRUCTURE

```text
src/index.ts                   public legacy-loader exports
src/server.ts                  catalog/auth composition and process-level dependencies
src/core/                      frozen provider-agnostic contracts; see AGENTS.md
src/opencode/                  auth store, registry, V1 hooks, catalog/language wiring
src/providers/claude/          credentials and compatibility path; see AGENTS.md
src/providers/command-code/    client version, /alpha/generate, provider-local NDJSON
src/providers/cursor/          private Node bridge and direct Run runtime; see AGENTS.md
src/providers/ollama/          localhost daemon and catalog runtime; see AGENTS.md
src/{catalog,http,logging}/    small shared boundary implementations
src/sdk/                       package subpath entry points
scripts/                       build, source-policy, and pure-LOC checks
tests/                         unit/integration/e2e suites and fakes; see AGENTS.md
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Public plugin exports | `src/index.ts` | Exactly five named legacy plugin functions |
| Server composition | `src/server.ts` | Registry, transports, auth servers, disposal |
| Shared contracts | `src/core/AGENTS.md` | No provider protocol or concrete I/O |
| OpenCode integration | `src/opencode/` | V1 API boundary; V2 imports stay in `beta-api.ts` |
| Claude changes | `src/providers/claude/AGENTS.md` | Credentials, compatibility stream, writeback |
| Cursor changes | `src/providers/cursor/AGENTS.md` | Bridge, retries, sessions, pinned codecs |
| Ollama changes | `src/providers/ollama/AGENTS.md` | Local/Cloud catalog and local generation |
| Command Code changes | `src/providers/command-code/` | Request lifecycle and NDJSON remain local |
| Test placement | `tests/AGENTS.md` | Deterministic fakes and isolated E2E |
| Policy failures | `scripts/check-source-policy.ts` | AST/source-boundary violations |
| Size failures | `scripts/check-file-size.ts` | 250 pure-LOC ceiling |

## CONNECTION MODEL

- `providers` defaults to all four; explicit `[]` disables all.
- Publication requires the provider-specific OpenCode auth record and usable
  vendor/local credential state.
- Public root exports are exactly `connectorServer`, `claudeAuthServer`,
  `cursorAuthServer`, `commandCodeAuthServer`, and `ollamaAuthServer`.
- `src/opencode/providers.ts` owns cross-provider registration; protocol code
  stays inside its provider directory.
- Command Code uses `/alpha/generate` and provider-local NDJSON handling.
- No vendor CLI is required at runtime. Claude/Command Code client versions
  resolve from an env override, an installed binary, or the npm registry via
  `src/http/package-version.ts`; never pin a version constant.
- `credentialRefresh` (`auto` | `never`, `leadMs`) governs Claude token refresh
  so one machine can own refresh while file copies stay read-only.
- Provider snapshots, health, and failures remain isolated.

## CONVENTIONS

- Bun only; do not add npm/pnpm lockfiles.
- Strict exported types; no `any`, type assertions, non-null assertions,
  TypeScript suppressions, or enums.
- Default exports are lint-forbidden except at the `src/index.ts` and
  `src/server.ts` loader boundaries.
- Create branded IDs only through their Zod parsers.
- Provider directories never import sibling providers.
- `src/logging/logger.ts` is the only console-call boundary.
- `src/opencode/beta-api.ts` is the only OpenCode V2 import boundary.
- Core time uses injected `Clock`.
- Every TypeScript file stays at or below 250 pure LOC.
- Derived files carry an SPDX/source header pointing to
  `THIRD_PARTY_NOTICES.md`.

## ANTI-PATTERNS

- Do not mix provider parsers, credentials, or protocol fallback into core.
- Do not log credentials or move console calls outside the logging boundary.
- Do not bypass provider auth/catalog readiness.

## COMMANDS

```bash
bun run check
bun run build
bun test
bun run test:provider
bun run test:integration
bun run test:e2e
bun run verify:package
```

`bun run check` runs Biome, TypeScript, source policy, pure-LOC policy, and the
policy foundation tests. `bun run verify:package` is a dry-run package pack.

## RELEASE

- `.github/workflows/release.yml` publishes to npm when a `v*` tag is pushed
  and fails if the tag differs from `package.json`.
- The first publish of a new package needs the `NPM_TOKEN` repository secret;
  afterwards configure npm trusted publishing for `release.yml` and remove it.
- Bump `package.json`, both READMEs, `CHANGELOG.md`, and
  `tests/unit/index/package-export.test.ts` together.

## SAFETY

- Do not claim affiliation with OpenCode or any provider.
- Do not describe unpublished provider protocols as public APIs.
- Do not mint OAuth, bypass access controls, or infer service permission from
  this repository's license.
- Preserve the English/Korean disclaimer meaning; `LICENSE` controls on conflict.
- Never reset, checkout, stash, or revert unrelated dirty-worktree changes.
