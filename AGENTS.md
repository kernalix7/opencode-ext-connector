# PROJECT KNOWLEDGE BASE

**Updated:** 2026-08-28
**Repository:** unborn HEAD; preserve the existing dirty worktree

## OVERVIEW

Unofficial OpenCode plugin exposing Claude, Cursor, Command Code, and Ollama from
one `opencode.json` entry. It reuses existing vendor sessions and never mints
OAuth. Source is BSD-3-Clause; third-party service access and terms remain the
user's responsibility.

Stack: Bun 1.3.14, TypeScript 6.0.2 strict, Zod 4.1.8,
`@opencode-ai/plugin@1.18.18`, and `@ai-sdk/provider@3.0.8` LanguageModelV3.
Cursor direct generation requires Node >=22.

## STRUCTURE

```text
src/index.ts                         five legacy plugin function exports only
src/server.ts                        combined catalog and auth server wiring
src/core/                            frozen shared contracts
src/opencode/                        auth store, provider registry, v1 hooks/language wiring
src/providers/claude/                Claude credentials, compatibility fetch, catalog
src/providers/command-code/          Command Code request/NDJSON provider
src/providers/cursor/                direct HTTP/2+Connect+protobuf runtime
  bridge-client.ts                   Bun parent for the private Node child
  h2-bridge.ts                       Node child entry
  direct-runtime.ts / direct-run.ts  logical Run and physical retry orchestration
  recovery.ts                        fixed checkpoint/history recovery and idle watchdog
  stream-adapter.ts                  one V3 stream across physical attempts
  run-session.ts                     parked calls, ownership, continuation, TTL
  proto/                             strict pinned Cursor codecs
src/providers/ollama/                local daemon, Cloud catalog, pull/chat runtime
src/logging/logger.ts                only allowed console sink
scripts/                             source policy and 250 pure-LOC gate
tests/{unit,integration,e2e,support}/ Bun tests and deterministic fakes
```

The removed `cursor-agent` pool/child path must not be reintroduced. Cursor
generation uses a plugin-owned Node child over private stdio and opens no plugin
listening daemon.

## CONNECTION MODEL

- `providers` defaults to all four; explicit `[]` disables all.
- A provider publishes models only when a matching OpenCode auth record and its
  vendor CLI credential both exist.
- Root exports are exactly `connectorServer`, `claudeAuthServer`,
  `cursorAuthServer`, `commandCodeAuthServer`, and `ollamaAuthServer`; there is
  no default export.
- Claude remains on the built-in `anthropic` SDK compatibility path.
- Cursor calls unpublished `api2.cursor.sh` AgentService Connect+protobuf. Tool
  results continue on the same bidi Run; parked calls are never replayed.
- Command Code uses `/alpha/generate` with provider-local NDJSON handling.
- Ollama uses fixed localhost `/api/tags`, `/api/pull`, and `/api/chat`; Cloud
  catalog discovery is anonymous and limited to official Ollama Cloud/library
  pages. API keys, `OLLAMA_HOST`, and direct Cloud generation are forbidden.
- Provider health and failures are isolated.

## CONVENTIONS

- Bun only; no npm/pnpm lockfiles.
- Strict exported types; no `any`, type assertions, non-null assertions,
  TypeScript suppressions, enums, or default exports.
- Branded IDs are created only through their Zod parsers.
- Provider directories never import sibling providers.
- No credential logging. Console calls are allowed only in
  `src/logging/logger.ts`.
- Core uses injected `Clock`; tests use `FakeClock` and no sleeps.
- Tests use `bun:test` and Given/When/Then comments.
- Every source file stays at or below 250 pure LOC.
- Derived files carry an SPDX/source header and point to
  `THIRD_PARTY_NOTICES.md`.
- Credential writeback is disabled unless explicitly opted in.

## KEY COMMANDS

```bash
bun run check
bun test
bun run test:provider
bun run test:integration
bun run test:e2e
bun run build
bun run verify:package
```

The E2E suite runs real isolated `opencode serve` processes under temporary
HOME/XDG directories. It must not inherit host credentials, proxy/token
variables, or access external vendor endpoints.

## SAFETY

- Do not claim affiliation with OpenCode or any provider.
- Do not call Cursor's unpublished protocol a public API.
- Do not mint OAuth, bypass access controls, or infer service permission from
  this repository's license.
- Do not mix provider protocols in shared core.
- Do not add implicit protocol fallback after drift; fail that provider.
- Preserve EN/KO disclaimer meaning; LICENSE controls on conflict.
- Never reset, checkout, stash, or revert unrelated dirty-worktree changes.
