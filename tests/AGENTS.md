# TEST SUITE

Bun test layers mirror production boundaries and use deterministic clocks, transports,
processes, fixtures, and loopback servers.

## WHERE TO LOOK

| Test kind | Location | Use for |
|-----------|----------|---------|
| Unit | `unit/` | One source contract; provider tests mirror `src/providers/` |
| Integration | `integration/` | Ollama loopback and root composition/isolation boundaries |
| End-to-end | `e2e/` | Built package with real isolated `opencode serve` processes; V1 uses the original CLI, V2 a private binary |
| Shared fakes | `support/` | Clock, HTTP, process, logging, catalog, package/process helpers |
| Account binding | `unit/opencode/v1-account-binding.test.ts`, `unit/opencode/v1-generation-edges.test.ts`, `unit/opencode/v2-{auth,scope,routing,lifecycle}.test.ts` | Key/generation/membership/disposal isolation and selected-connection behavior |
| Official API routes | `unit/providers/claude/api-*.test.ts`, `unit/providers/command-code/api-wire.test.ts` | Offline catalog/generation and supported-endpoint routing |
| Retirement | `unit/index/`, `unit/opencode/v2-xai-option.test.ts`, `support/xai-package-entrypoint.test.ts` | Inert root hooks, Cursor SDK rejection, dedicated xAI retirement, rejected options |
| Global preload | `setup.ts`, `../bunfig.toml`, `support/test-package.ts` | Compile isolated temporary package before Bun loads tests; cleanup afterward |

## CONVENTIONS

- Import assertions and lifecycle hooks from `bun:test`.
- Structure behavioral tests with `// Given`, `// When`, and `// Then`; a compact combined
  comment is acceptable for a one-step case.
- Use `FakeClock.advanceBy()` for deadlines, backoff, TTL, and cleanup. Do not wait on wall
  time when the production contract accepts `Clock`.
- Use `FakeHttpTransport`, fake process supervisors, memory catalog/log sinks, and provider
  loopbacks instead of vendor endpoints.
- Put reusable deterministic doubles in `support/`; keep protocol-specific fixtures with the
  owning provider when they are not cross-suite utilities.
- Unit provider tests import their own provider plus core/support only; integration tests own
  real cross-process or stream boundaries.
- E2E explicitly supplies temporary `HOME`, `XDG_CACHE_HOME`, `XDG_CONFIG_HOME`, and
  `XDG_DATA_HOME`, starts on `127.0.0.1` with an ephemeral port, and closes every process.
- Package-install tests operate on a dry packed artifact in temporary directories.
- Retain the normal package preload: its per-run temporary output avoids cleaning or racing
  the repository `dist`. Package-install coverage includes Node/npm consumption.
- Old Cursor bridge/run/protobuf fixtures are removed. Use current official API and retirement
  fixtures; fixture keys are synthetic, never real vendor credentials.
- V1 and V2 end-to-end lanes use two binaries: the original installed OpenCode CLI, and a
  private V2 binary from `OPENCODE_V2_BIN` or `opencode2`. Target `@opencode/cli@2.0.20` and
  `@opencode/plugin@2.0.20`. Do not treat an older beta CLI as that target.
- Default `bun test` skips V2 when `OPENCODE_V2_BIN` is unset and `opencode2` is absent.
  `bun run test:e2e:v2` sets `OPENCODE_V2_BIN` (default `opencode2`) and does not silently skip.
- V2 loads the compiled `dist/v2-entry` directory and retains the no-I/O `v2-sdk.ts`
  bootstrap required before external host hooks. Loopback E2E is not live-provider validation.

## ANTI-PATTERNS

- Real sleeps for behavior controlled by an injected clock.
- Inheriting host credentials, tokens, proxy settings, HOME/XDG state, or provider config.
- Contacting Claude, Cursor, Command Code, Ollama Cloud, or an arbitrary local daemon.
- Using real credentials, live vendor calls, or exploit workflows in this test lane.
- Replacing malformed-input fixtures with happy-path mocks when testing parser hardening.
- Sharing provider protocol fakes across providers or weakening assertions to accommodate drift.
