# XAI AUTHORITY/CONSUMER RESTORATION

The user's full restoration request supersedes the 0.9.0 retirement decision.
0.9.1 restores the original V1 consumer through root/dedicated entries and the
authority observer. The support boundary is finalized: V2 consumer setup rejects
before allocation. Cursor stays retired. Parent still owns final corrected gates;
no final readiness, publication or live vendor claim follows.

## WHERE TO LOOK

| Concern | Location | Contract |
|---------|----------|----------|
| Secure projection | `access-state.ts` | Closed v1 access-only schema, absolute XDG/HOME, private owned single-link file |
| Authority | `authority-observer.ts` | Existing auth observation, fixed external helper, polling/retry/disposal |
| Consumer | `consumer-auth.ts` | Exact selected marker, per-fresh-request reread, pending-attempt isolation |
| Root composition | `src/server.ts`, `src/index.ts` | Six V1 exports; root consumer and authority lifecycle under independent mode |
| Dedicated entry | `src/xai.ts` | Only `xaiAuthServer`, consumer auth hook with `methods: []` |
| Options | `src/core/options.ts`, host options | Strict authority/consumer object, omission disabled, not in provider allow-list |
| Tests | `tests/unit/providers/xai/`, `tests/unit/core/xai-options.test.ts` | Secure-file/lifecycle regressions, V1-only consumer and typed V2 rejection; parent owns final gates |

## CONTRACTS

- Independent `xaiOAuth: { mode: "authority" | "consumer" }`; omission/undefined
  normalizes to null/disabled. Literal null, missing/invalid mode or extra keys
  reject. Claude policy and the three-provider allow-list remain independent.
- V1 requires exactly `{ type: "api", key: "cli-session:xai" }`. Operator
  provisions the marker; it is not a credential. Loader sentinel `xai-access-file`
  is not a real API key. `methods: []` adds no login or `/connect` method.
- Access path is absolute XDG_DATA_HOME/opencode/xai-access.json, or absolute
  HOME/.local/share/opencode/xai-access.json when XDG is unset/empty. Relative
  XDG fails closed. Open read-only/no-follow, verify current-user ownership,
  regular file, link count 1 and exact 0600; close handles deterministically.
- Closed v1 schema: schema_version 1, provider xai, ready with nonempty access
  and integer expires (epoch ms), or unavailable without access/expiry. Extra
  fields, refresh tokens, malformed JSON and non-future expiry fail closed.
- Every fresh V1 request rereads updated projection through the same loader,
  supporting access A then access B on separate fresh requests.
  Pending attempts retain original path/token fingerprint/expiry/selected gate
  and lifetime. Observed drift blocks, rather than adopting a replacement or
  replaying the prompt. Recheck trusted targets, cancellation and disposal;
  reject redirects.
  No 401 prompt replay, new grant, connector refresh or implicit paid fallback.
- Authority observes existing auth changes only and invokes fixed absolute
  HOME/.local/bin/opensandbox-xai-auth-sync, no args. Env contains HOME and fixed
  PATH=/usr/local/bin:/usr/bin:/bin plus XDG_DATA_HOME only when absolute.
  Poll 1000 ms, retry failed observation/launch/non-zero exit after 5000 ms;
  dispose cancels scheduled and supervised work. No secret argv/env/logs.
- The external manager owns projection and session management. No package access
  writer, secret mirror, connector-driven xAI refresh or guest refresh token.
  The actual helper is absent here and is neither bundled nor installed;
  native V2 manager compatibility is unverified.
- Native CLI 2.0.20 `/api/experimental/generate` bypasses all session hooks;
  nativeModelResolver ignores SDK hooks and no auth-factory interceptor is exposed.
  Consumer is V1-only. V2 must reject it with a typed setup error before allocation,
  without a session extension or native HTTP/WebSocket interception promise.
  Do not claim global fail-closed native API enforcement. Independent native API-key
  use and other V2 providers remain unchanged when consumer opt-in is unset.
- V2 authority observes selected `active`/`resolve`, including removal into stable
  absence, without V1 storage or unselected-env fallback. The external manager
  owns projection; its compatibility with the native V2 source is unverified.
- V1 configuration uses the root npm tuple with xaiOAuth; providers [] permits
  xAI-only use. Dedicated /xai is a Node import; raw npm subpath plugin loading
  is unverified. V2 config uses plural plugins and the directory URL only.

## EVIDENCE STATUS

Built public root/dedicated consumer QA and production-supervised synthetic-helper
initial/change/removal QA passed on Bun 1.3.14 and Node 24.20.0, without live vendors.
Parent's check and 758-pass/0-fail suite predate the V2 boundary correction. Corrected
full suite, packed manifest, exact-commit CI and registry verification remain pending.

## ANTI-PATTERNS

- In-package projection writers, refresh-token transfer, new grants or refresh.
- Logging bearer bytes, credentials in URLs/argv/env, or vendor env token fallback.
- Treating sentinel/marker values as outbound credentials or new login methods.
- Adopting replacement credentials in a paused attempt or replaying after 401.
- Claiming absent-helper/native V2 manager validation, release-gate completion,
  entitlement, vendor permission or free/zero-cost use from offline evidence.
