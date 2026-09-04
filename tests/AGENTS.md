# TEST SUITE

Bun test layers mirror production boundaries and use deterministic clocks, transports,
processes, fixtures, and loopback servers.

## WHERE TO LOOK

| Test kind | Location | Use for |
|-----------|----------|---------|
| Unit | `unit/` | One source contract; provider tests mirror `src/providers/` |
| Integration | `integration/` | Bridge, continuation, isolation, and loopback boundaries |
| End-to-end | `e2e/` | Built package with real isolated `opencode serve` processes |
| Shared fakes | `support/` | Clock, HTTP, process, logging, catalog, package/process helpers |
| Cursor fixtures | `support/cursor-*`, `unit/providers/cursor/proto/` | Bridge/run and pinned byte fixtures |
| External snapshots | `fixtures/` | Versioned protocol/package inputs, never live credentials |
| Global preload | `setup.ts`, `../bunfig.toml` | Build package before Bun loads tests |

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

## ANTI-PATTERNS

- Real sleeps for behavior controlled by an injected clock.
- Inheriting host credentials, tokens, proxy settings, HOME/XDG state, or provider config.
- Contacting Claude, Cursor, Command Code, Ollama Cloud, or an arbitrary local daemon.
- Replacing malformed-input fixtures with happy-path mocks when testing parser hardening.
- Sharing provider protocol fakes across providers or weakening assertions to accommodate drift.
