# PROJECT KNOWLEDGE BASE

**Generated:** 2026-08-18
**Commit:** none (unborn HEAD)
**Branch:** none

## OVERVIEW

Unofficial OpenCode plugin that will expose three **subscription** providers (Claude, Cursor, Command Code) via one `opencode.json` entry. Reuses already-logged-in vendor CLIs; does not mint new OAuth. License covers this repo's source only — not third-party service use.

Stack: Bun 1.3.14, TypeScript 6.0.2 strict, Zod 4.1.8, `@opencode-ai/plugin@1.18.18` (`/v2/promise`), `@ai-sdk/provider@3.0.8` (`LanguageModelV3`). License: BSD-3-Clause.

## STRUCTURE

Current (T0 scaffold + T1 core only):

```
.
├── src/core/          # frozen shared contracts — see src/core/AGENTS.md
├── scripts/           # AST policy + 250-LOC gate (CI-equivalent)
├── tests/unit/core/   # 1:1 bun:test mirrors of src/core
├── tests/unit/scripts/
├── tests/support/     # FakeClock / FakeHttpTransport / FakeProcess* / MemoryLogSink
├── docs/README.ko.md  # Korean disclaimer twin of README.md
├── LICENSE            # BSD-3-Clause, copyright kernalix7 (no email)
└── package.json       # main=./dist/index.js — src/index.ts DOES NOT EXIST YET
```

Planned, referenced by policy, **absent on disk**:

```
src/index.ts                 # plugin entry (define from /v2/promise)
src/opencode/beta-api.ts     # ONLY allowed @opencode-ai/plugin|sdk /v2 import
src/logging/logger.ts        # ONLY allowed console.* sink
src/providers/{claude,cursor,command-code}/
THIRD_PARTY_NOTICES.md       # required before copying upstream
```

`package.json` scripts `test:integration` / `test:provider` point at dirs that do not exist.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add/change a core contract | `src/core/` + matching `tests/unit/core/*.test.ts` | TDD; keep <250 pure LOC |
| Add a provider adapter | `src/providers/<slug>/` (create) | Implement `ProviderAdapter`; no sibling-provider imports |
| Wire OpenCode plugin | `src/index.ts` + `src/opencode/beta-api.ts` (create) | `define({ id, setup })` from `/v2/promise`; mutate `ctx.aisdk` |
| Auth / CLI reuse | future provider dirs | Reuse existing CLI creds; no new OAuth; no writeback unless opt-in |
| Compatibility proxy | future provider-local | In-process custom fetch or 127.0.0.1 server owned by plugin lifecycle |
| Policy / LOC | `scripts/check-source-policy.ts`, `scripts/check-file-size.ts` | Enforced by `bun run check` |
| Disclaimer / license | `README.md`, `docs/README.ko.md`, `LICENSE` | Keep EN/KO in sync; license wins on conflict |
| Test fakes | `tests/support/` | Injected Clock/Http/Process only — no wall-clock |

## CODE MAP

| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `ProviderId` / `parseProviderId` | branded Zod | `src/core/ids.ts` | models, errors, adapter | Open kebab slug `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 1–64; reject, don't normalize |
| `ModelId` / `parseModelId` | branded Zod | `src/core/ids.ts` | models | 1–256, no controls, trim-strict; case-sensitive |
| `ProviderSnapshot` | union | `src/core/models.ts` | adapter | `ready \| stale \| unavailable`; stale keeps last models |
| `ProviderAdapter` | interface | `src/core/adapter.ts` | refresh | `snapshot(signal)`; pull, not push |
| `CatalogPublisher` | interface | `src/core/adapter.ts` | refresh | Full replace of that provider's catalog |
| `refreshProviderCatalog` | fn | `src/core/adapter.ts` | tests | Abort before I/O; reject providerId mismatch (`AdapterError`, not published) |
| `ConnectorError` + subclasses | class | `src/core/errors.ts` | all core | Typed `code` + `retryable`; Zod parse errors stay `ZodError` |
| `Clock` / `createDeadline` | iface/fn | `src/core/clock.ts`, `deadline.ts` | logger, health | Injected time; no `Date.now` / `setTimeout` / `AbortSignal.timeout` in core |
| `createAsyncDisposable` | fn | `src/core/lifecycle.ts` | deadline, fakes | Idempotent; second call returns same promise |
| `reduceHealth` | fn | `src/core/health.ts` | options | Deterministic exp backoff; `retryAtMs` from event clock |
| `HttpTransport` | iface | `src/core/http.ts` | — | Contract only; real fetch later |
| `ProcessSupervisor` | iface | `src/core/process.ts` | — | Contract only; Cursor child process later |
| `createConnectorLogger` | fn | `src/core/logger.ts` | — | Sink-based; redacts token/cookie/secret keys + URL userinfo/query |
| `parseConnectorOptions` | fn | `src/core/options.ts` | — | Defaults 30s snapshot / 1s–60s backoff; `undefined` → default |
| `inspectSource` | fn | `scripts/check-source-policy.ts` | tests | AST bans listed below |

No plugin `define` / `LanguageModelV3` wiring exists yet.

## CONVENTIONS

- Package manager is **Bun only** (`packageManager: bun@1.3.14`). No npm/pnpm lockfiles.
- `verbatimModuleSyntax` + `isolatedDeclarations` (build) → explicit types on every export.
- `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` + `noPropertyAccessFromIndexSignature`.
- Biome: 2-space, double quotes, semicolons asNeeded, trailing commas, `noDefaultExport` **error**. Plugin `export default define(...)` will need a file-level override when added.
- Tests: `bun:test`, `// Given` / `// When` / `// Then` comments, no wall-clock sleeps.
- Brand IDs only via Zod `.brand()` + `parse*`. Never `as ProviderId`.
- Core logger is sink-based. `console.*` allowed **only** at `src/logging/logger.ts` (file missing).
- `@opencode-ai/plugin/v2` and `@opencode-ai/sdk/v2` allowed **only** in `src/opencode/beta-api.ts` (file missing).
- Provider packages must not import sibling `src/providers/<other>/`.
- Derived upstream files need `// Derived from <repo>. Licensed under <SPDX>. See THIRD_PARTY_NOTICES.md.` plus the original notice file (not created yet).
- Frozen pins: do not bump `@opencode-ai/plugin` / `@ai-sdk/provider` / `zod` without a plan.

## ANTI-PATTERNS (THIS PROJECT)

- Claim affiliation with OpenCode, Anthropic, Cursor, Command Code.
- Treat BSD-3 as permission to use a third-party service, reuse subscription OAuth in unofficial clients, or bypass ToS.
- New OAuth / reverse-engineered private APIs. Reuse the vendor CLI's existing login.
- Mix Claude/Cursor/Command-Code protocol, headers, or stream parsers in shared core.
- Implicit protocol fallback when upstream CLI version is unsupported — fail that provider only.
- Log credentials. Logger must keep redacting `authorization`, `cookie`, `token`, `apikey`, `password`, `secret`, URL userinfo, and all query values.
- `any`, `as T` (except `as const` is also banned by policy), non-null `!`, `@ts-ignore` / `@ts-expect-error`, `enum`, `console.*` outside the logging boundary.
- Wall-clock `Date.now` / `setTimeout` / `AbortSignal.timeout` inside `src/core`. Use `Clock`.
- Files >250 **pure** LOC (comments/blank excluded by `countPureLines`).
- Default exports (Biome) except a future documented plugin entry override.
- Writing `auth.json` / keychain writeback without an explicit opt-in flag.
- Shipping without `THIRD_PARTY_NOTICES.md` once any upstream file is copied.

## UNIQUE STYLES

- Target architecture: **one plugin + plugin-owned compatibility proxy + three isolated adapters**. User never starts a daemon.
- Snapshot `stale` = last good catalog + `ProviderFailureReason`. `unavailable` has no models.
- Health isolates per provider: one adapter dying must not remove the others from catalog.
- Compatibility proxy (planned): OpenCode request rewritten to look like the official CLI (Claude headers/identity, `cursor-agent` NDJSON, Command Code `/alpha/generate`). Not a public HTTP service.
- Precedents (pin + attribute if copying):
  - `griffinmartin/opencode-claude-auth@0f0ff6f` MIT
  - `Nomadcxx/opencode-cursor@8e14a26` BSD-3 (`package.json` says ISC — keep the LICENSE text)
  - `thaolaptrinh/commandcode-api-proxy@f4b3390` MIT
  - `brent-weatherall/opencode-commandcode-provider` MIT

## COMMANDS

```bash
bun run check              # lint + typecheck + policy + loc + test:foundation
bun test                   # all bun:test (currently unit/core + unit/scripts)
bun test tests/unit/core   # T1 contracts
bun run test:foundation    # scripts only
bun run build              # tsc -p tsconfig.build.json → dist/ (no src/index.ts yet)
bun run verify:package     # build + bun pm pack --dry-run
bun run typecheck
bun run lint               # biome check .
```

No GitHub Actions, Makefile, or publish script. No git commit yet.

## NOTES

- `src/index.ts` missing → `main`/`exports` are aspirational. Do not publish.
- `test:integration` / `test:provider` will fail until those trees exist.
- OpenCode host must call `ctx.aisdk.language` / `ctx.aisdk.sdk` at resolve time; registering a bare `LanguageModelV3` is ignored.
- No catalog-reload hook in plugin v2/promise — plan for re-`setup` or host events.
- Dispose is not guaranteed on every host unload path; adapters must be idempotent.
- Disclaimer is intentionally verbose and duplicated EN/KO. Do not "simplify" it.
- If disclaimer conflicts with LICENSE, LICENSE controls.
- Personal-use / no-liability intent is already in BSD-3 + README; do not invent a custom non-commercial license.
