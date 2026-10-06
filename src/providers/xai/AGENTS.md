# XAI OAUTH PROJECTION RETIREMENT

The authority/consumer OAuth projection is retired in the official-only 0.8
candidate. Use native OpenCode `xai` API-key authentication outside this connector.
This directory retains only this knowledge document.

## WHERE TO LOOK

| Concern | Location | Contract |
|---------|----------|----------|
| Root V1 compatibility export | `src/index.ts`, `src/server.ts` | `xaiAuthServer` remains one of six named functions and returns an empty hook |
| Dedicated `/xai` entry | `src/xai.ts` | Invoking its `xaiAuthServer` throws `XaiOAuthRetiredError` |
| Retired option rejection | `src/core/options.ts`, `src/opencode/host-options.ts` | Present `xaiOAuth` rejects, including disabled/malformed values; no role is normalized |
| Tests | `tests/support/xai-package-entrypoint.test.ts`, `tests/unit/opencode/v2-xai-option.test.ts`, `tests/unit/index/` | Dedicated retirement entry, option rejection, inert root export |

## CONVENTIONS

- Root and dedicated subpath behavior are distinct: inert compatibility versus explicit
  retirement error. Neither returns a consumer auth hook or registers an integration.
- No access-state file, bearer sourcing, observer, projection helper, timer, or credential
  synchronization is implemented. There is no V2 xAI connector integration.
- Native xAI API-key storage and generation belong to OpenCode, not this connector.

## ANTI-PATTERNS

- Writing guest access files or shipping tokens across machines.
- Minting, refreshing, rotating, or projecting xAI OAuth.
- Caching or logging access/refresh tokens, including bearer bytes in URL queries,
  plugin arguments, argv, environment, or connector diagnostics.
- Using vendor environment variables as projection access sources or restoring consumer hooks.
