# CURSOR RETIREMENT

Cursor is unsupported in the official-only 0.8 candidate. This directory retains
only this knowledge document; the private provider implementation is removed.

## WHERE TO LOOK

| Concern | Location | Contract |
|---------|----------|----------|
| SDK compatibility entry | `src/sdk/cursor.ts` | `createCursor()` returns a stub; `languageModel()` throws `CursorRetiredError` |
| Root V1 auth export | `src/index.ts`, `src/server.ts` | `cursorAuthServer` remains one of six named exports and returns an empty hook |
| Options/registry | `src/core/options.ts`, `src/opencode/providers.ts` | `cursor` rejects in `providers`; registry contains only Claude/Command Code/Ollama |
| Retirement coverage | `tests/unit/index/`, `tests/unit/opencode/providers.test.ts` | Package exports and supported-provider registration |

## CONVENTIONS

- Keep the compatibility SDK fail-closed and the root auth export inert; neither registers
  Cursor models or connection methods.
- There is no private Node HTTP/2 bridge, AgentService Run, protobuf codec, parked-session
  continuation, credential-file/token lookup, or Cursor-specific build step.
- Old Cursor bridge/protocol fixtures are removed; do not direct tests to those paths.
- Preserve SPDX/source notices for any retained derived material and its notice record.

## ANTI-PATTERNS

- Reintroducing `cursor-agent`, its process pool, or resume-based child generation.
- Opening a listening daemon or passing credentials in child argv/environment.
- Reintroducing private-protocol generation or an implicit CLI/SDK fallback.
- Treating the retirement stub as a public Cursor API or an active provider.
