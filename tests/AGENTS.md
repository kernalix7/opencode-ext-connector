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
| Credential goals | `unit/opencode/{v1,v2}-subscription-goal.test.ts`, `subscription-scope-goal.test.ts` | Actual hooks with synthetic file-only sessions, tools/streams and revocation |
| Native Claude and shutdown | `unit/opencode/v1-native-claude-*.test.ts`, `v1-owner-shutdown.test.ts` | Gate before renewal, trusted targets, lineage and all-disposer shutdown |
| xAI restoration | `unit/core/xai-options.test.ts`, `unit/opencode/xai-host-options.test.ts`, `unit/providers/xai/`, `support/xai-package-entrypoint.test.ts`, `unit/index/` | Strict modes, secure state, root/dedicated V1 consumer, authority lifecycle and typed pre-allocation V2 consumer rejection |
| Cursor retirement | `unit/index/`, SDK tests | Inert root hook and explicit Cursor SDK rejection remain |
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
- Old Cursor bridge/run/protobuf fixtures are removed. Default protocol fixtures use
  existing credential compatibility; optional official API SDK and Cursor retirement fixtures
  remain independent. All fixture credentials are synthetic, never vendor secrets.
- V1 and V2 end-to-end lanes use two binaries: the original installed OpenCode CLI, and a
  private V2 binary from `OPENCODE_V2_BIN` or `opencode2`. Target `@opencode/cli@2.0.20` and
  `@opencode/plugin@2.0.20`. Do not treat an older beta CLI as that target.
- Default `bun test` skips V2 when `OPENCODE_V2_BIN` is unset and `opencode2` is absent.
  `bun run test:e2e:v2` sets `OPENCODE_V2_BIN` (default `opencode2`) and does not silently skip.
- V2 loads the compiled `dist/v2-entry` directory and retains the no-I/O `v2-sdk.ts`
  bootstrap required before external host hooks. Loopback E2E is not live-provider validation.
- The user's full xAI restoration supersedes prior option-rejection/dedicated-retirement
  expectations. Product workers own behavioral updates; metadata-only work must not weaken
  runtime expectations or claim a failing in-progress implementation passed.
- xAI evidence must distinguish next-fresh-request projection rotation from paused-attempt
  drift blocking, exact marker, target/selected-source/lifetime checks and disposal.
  Include same-loader fresh access A-to-B rotation, pending drift blocking, redirect
  rejection and cancellation. Consumer support is V1-only; V2 must reject opt-in
  with a typed setup error before allocation. Omitted consumer opt-in must preserve
  independent native API-key use and other V2 providers.
- Native CLI 2.0.20 experimental generation bypasses session hooks and native model
  resolution ignores SDK hooks, with no exposed auth-factory interceptor. Session
  fakes cannot prove native HTTP/WebSocket interception or global API enforcement.
  V2 authority tests cover selected active/resolve changes and removal into stable
  absence without V1-store or unselected-env fallback.
- The actual external helper is absent here; selected-source V2 manager support is unverified.
  Built public root/dedicated consumer QA and production-supervised synthetic-helper
  initial/change/removal QA passed on Bun 1.3.14/Node 24.20.0 without live vendors.
  Parent's check and 758-pass/0-fail suite predate the V2 correction, not final gates.
  Parent owns corrected full-suite, frozen packed manifest, exact-commit CI and
  registry verification; all remain pending and no gate approval is recorded here.

## ANTI-PATTERNS

- Real sleeps for behavior controlled by an injected clock.
- Inheriting host credentials, tokens, proxy settings, HOME/XDG state, or provider config.
- Contacting Claude, Cursor, Command Code, Ollama Cloud, or an arbitrary local daemon.
- Using real credentials, live vendor calls, or exploit workflows in this test lane.
- Replacing malformed-input fixtures with happy-path mocks when testing parser hardening.
- Sharing provider protocol fakes across providers or weakening assertions to accommodate drift.
