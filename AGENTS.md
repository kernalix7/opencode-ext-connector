# PROJECT KNOWLEDGE BASE

**Updated:** 2026-09-23
**Code baseline:** `v0.7.1` (Claude authority hardening: strict credential-authority-options module, isolated child env without `ANTHROPIC_API_KEY`, hardened lifecycle cleanup; six root exports preserved)
**Branch:** `release/v0.7.1`; clean, current release worktree at `/tmp/opencode-release-v071`, tracking `origin/main`

## OVERVIEW

Unofficial OpenCode plugin exposing Claude, Cursor, Command Code, and Ollama from
one `opencode.json` entry, with an opt-in xAI host authority on the root entry
and a guest consumer loaded through the dedicated `opencode-ext-connector/xai`
subpath. It reuses existing vendor sessions and never mints OAuth. Source is
BSD-3-Clause; third-party access and terms remain the user's responsibility.

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
src/providers/ollama/          trusted daemon endpoints and catalog runtime; see AGENTS.md
src/providers/xai/             access-state, authority observer, and consumer auth; see AGENTS.md
src/process/                   production child-process supervision and disposal
src/{catalog,http,logging}/    small shared boundary implementations
src/sdk/                       cursor, command-code, ollama package subpath entries
src/xai.ts                     dedicated `/xai` subpath loader (xaiAuthServer only)
scripts/                       build, source-policy, and pure-LOC checks
tests/                         unit/integration/e2e suites and fakes; see AGENTS.md
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Public plugin exports | `src/index.ts` | Exactly six named legacy plugin functions (xaiAuthServer added) |
| Server composition | `src/server.ts` | Registry, transports, auth servers, disposal |
| Shared contracts | `src/core/AGENTS.md` | No provider protocol or concrete I/O |
| OpenCode integration | `src/opencode/` | V1 API boundary; V2 imports stay in `beta-api.ts` |
| Claude changes | `src/providers/claude/AGENTS.md` | Credentials, compatibility stream, writeback |
| Process supervision | `src/process/production-supervisor.ts` | Spawn, abort, termination, and process cleanup |
| Cursor changes | `src/providers/cursor/AGENTS.md` | Bridge, retries, sessions, pinned codecs |
| Ollama changes | `src/providers/ollama/AGENTS.md` | Local/Cloud catalog and configured-daemon generation |
| xAI changes | `src/providers/xai/AGENTS.md` | Access file, authority observer, consumer auth |
| Command Code changes | `src/providers/command-code/` | Request lifecycle and NDJSON remain local |
| `/xai` subpath loader | `src/xai.ts` | Dedicated consumer entry, `xaiAuthServer` only |
| Test placement | `tests/AGENTS.md` | Deterministic fakes and isolated E2E |
| Policy failures | `scripts/check-source-policy.ts` | AST/source-boundary violations |
| Size failures | `scripts/check-file-size.ts` | 250 pure-LOC ceiling |

## CONNECTION MODEL

- `providers` defaults to all four; explicit `[]` disables all.
- Publication requires the provider-specific OpenCode auth record and usable
  vendor/local credential state.
- Public root exports are exactly `connectorServer`, `claudeAuthServer`,
  `cursorAuthServer`, `commandCodeAuthServer`, `ollamaAuthServer`, and
  `xaiAuthServer`.
- `src/opencode/providers.ts` owns cross-provider registration; protocol code
  stays inside its provider directory.
- Command Code uses `/alpha/generate` and provider-local NDJSON handling.
- No vendor CLI is required by the default runtime. Claude/Command Code client
  versions resolve from an env override, an installed binary, or the npm
  registry via `src/http/package-version.ts`; never pin a version constant.
- The optional Claude CLI credential authority is the only exception: it is
  Linux-only, requires `credentialManagement: "external"`, util-linux `flock`,
  and Claude Code >=2.1.265, and is disabled by default.
- Prefer `credentialRole: "owner" | "reader"` for shared Claude logins. Core
  normalizes owner to external management plus the Claude CLI authority and
  reader to external management without that authority. Role names describe
  credential ownership, not host/guest placement.
- `credentialRole` is input-only and cannot be combined with
  `credentialManagement`, `credentialAuthority`, `credentialRefresh`, or
  `writeBackCredentials`. The low-level options remain available for advanced
  control; behavior is capability-gated, so Cursor/Command Code stay read-only
  and Ollama is unaffected.
- Claude maps `connector` to auto/`60_000` + writeback and `external` to
  never/no-write with a credential re-read after 401; omitting all policy
  options preserves legacy auto/`60_000` + no-write, while legacy options still
  control behavior when supplied without `credentialManagement`.
- `credentialAuthority.claudeCli` schedules one restricted CLI request before
  expiry. Keep scheduling in the Claude provider, process control in
  `src/process/`, and process-level construction/disposal in `src/server.ts`.
  The Claude authority child inherits every defined string from the parent
  environment except `ANTHROPIC_API_KEY`, so the stored OAuth login is always
  used regardless of any in-memory key, and the Claude authority is wired and
  disposed by name in `src/server.ts` (standalone auth servers do not start it).
- `credentialRefresh` and `writeBackCredentials` remain deprecated but accepted
  alone for one migration cycle (custom lead times require the legacy config);
  combining either with `credentialManagement` is rejected.
- `xaiOAuth` enables an opt-in xAI host authority plus a guest consumer pair.
  The option accepts a strict `{ mode: "authority" | "consumer" }` value;
  omitting `xaiOAuth` disables the integration silently, and a present option
  with a missing or unknown `mode` is rejected at parse time. The role is
  independent of every Claude credential option and is preserved in parsed
  output as `xaiOAuth` (or `null` when omitted).
- `xaiOAuth.mode: "authority"` is honored on the root `connectorServer`
  entry. The host observer watches the OpenCode auth record and invokes a
  fixed no-arg helper to project guest access state. It does not write the
  access file, mint or refresh xAI OAuth, or carry tokens across machines.
- `xaiOAuth.mode: "consumer"` is honored only through the dedicated
  `opencode-ext-connector/xai` subpath. A subpath entry without `mode`
  returns an empty hook and the xAI provider stays disconnected; with mode
  `"consumer"` the connector returns the xAI auth hook and exposes no
  `/connect` methods (`methods: []` is part of the public contract).
- Provider snapshots, health, and failures remain isolated.
- `ollamaBaseURL` is a flat connector and standalone SDK option. It defaults to
  `http://localhost:11434`; explicit remote/self-hosted bases preserve path
  prefixes and are normalized for Ollama state. Do not add it to core options.

## WORKSPACE HANDOFF

- `release/v0.7.1` is the current release branch, checked out at
  `/tmp/opencode-release-v071` and tracking `origin/main`; `/workspace/project`
  remains the canonical `main` worktree.
- `archive/local-v0.6.1-869e92d` is a preserved local candidate branch pointing
  at the v0.6.1 docs commit; keep it as a reference snapshot until the v0.7.1
  release ships.
- `.opensandbox/project-id` and `sandbox.sh` are ignored local runner state. Keep
  them unless the user explicitly asks to remove OpenSandbox tooling.
- `.git/recovery/release-0.2.0-safety-62518cb/` is a checksum-verified local
  snapshot of the discarded dirty release worktree, not project source.
- Remote feature branches were intentionally left untouched.

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
bun run verify:package
```

`bun run check` runs Biome, TypeScript, source policy, pure-LOC policy, and the
policy foundation tests. `bun run verify:package` is a dry-run package pack.

## RELEASE

- `.github/workflows/release.yml` publishes to npm when a `v*` tag is pushed
  and fails if the tag differs from `package.json`.
- Configure npm trusted publishing for this repository and `release.yml` before
  tagging; releases use GitHub Actions OIDC and must not use `NPM_TOKEN` or
  token-bearing `.npmrc` configuration.
- Bump `package.json`, both READMEs, `CHANGELOG.md`, and
  `tests/unit/index/package-export.test.ts` together.

## SAFETY

- Do not claim affiliation with OpenCode or any provider.
- Do not describe unpublished provider protocols as public APIs.
- Do not mint OAuth, bypass access controls, or infer service permission from
  this repository's license.
- Preserve the English/Korean disclaimer meaning; `LICENSE` controls on conflict.
- Never reset, checkout, stash, or revert unrelated dirty-worktree changes.
