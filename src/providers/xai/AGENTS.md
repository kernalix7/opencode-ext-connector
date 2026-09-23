# XAI PROVIDER

Opt-in xAI authority and consumer pair. The host `connectorServer` runs the
authority observer; the dedicated `opencode-ext-connector/xai` subpath runs
the consumer hook. The connector never mints or refreshes xAI OAuth.

## WHERE TO LOOK

| Concern | Location | Contract |
|---------|----------|----------|
| Access file parsing | `access-state.ts` | Closed v1 schema, XDG or HOME path resolution, file gates, per-request reread |
| Host authority observer | `authority-observer.ts` | Auth record watch, no-arg helper invocation, retry, disposal |
| Guest consumer auth | `consumer-auth.ts` | Marker check, access file source, wrapped `fetch`, `methods: []` |
| Subpath entry | `src/xai.ts` | Dedicated `/xai` loader, exposes `xaiAuthServer` only |
| Server composition | `src/server.ts` (`xaiAuthServer`, `connectorServer` authority branch) | Wires observer into host disposal, returns consumer hook only when mode is `consumer` |
| Tests | `tests/unit/providers/xai/` | Access path, observer, consumer, integration |

## CONVENTIONS

- **Path resolution.** Use `${XDG_DATA_HOME}/opencode/xai-access.json` when
  `XDG_DATA_HOME` is set and absolute. On Linux only, fall back to
  `${HOME}/.local/share/opencode/xai-access.json` when `XDG_DATA_HOME` is
  unset or empty. A relative `XDG_DATA_HOME` (set but not absolute) fails
  closed: the access file is not inspected and the request is unavailable.
  The authority observer treats the same relative `XDG_DATA_HOME` as
  disabled, returning a no-op disposable without invoking the helper.
- **File gates.** The access file must be a regular file owned by the
  current user, with link count `1` and mode `0600`. Open with
  `O_RDONLY | O_NOFOLLOW`. A missing file, symlink, multi-link file, wrong
  owner, wrong mode, failed stat, malformed JSON, schema mismatch, or
  `expires` not strictly greater than `Clock.nowMs()` all return the
  unavailable state before any network call. Expired or malformed records
  raise `XaiAccessUnavailableError` for the request.
- **Per-request reread.** The consumer reads the access file on every
  outbound request and never trusts an in-memory token. The host observer
  reads the OpenCode auth record on each scheduled tick and tracks a
  fingerprint of the `xai` entry.
- **Authority helper invocation.** The observer invokes the fixed,
  no-argument helper at `${HOME}/.local/bin/opensandbox-xai-auth-sync`
  with `PATH` set to `/usr/local/bin:/usr/bin:/bin`, `HOME` always set, and
  `XDG_DATA_HOME` forwarded only when absolute. The helper is idempotent
  and delegates projection to the OpenSandbox manager; the connector
  neither writes the access file nor places a refresh token inside the
  guest. A non-zero exit is treated as transient and retried after
  `5000` ms without removing the xAI provider.
- **Consumer marker.** Consumer mode requires the exact OpenCode auth
  record `{ "type": "api", "key": "cli-session:xai" }`. Any other shape
  returns no auth; provisioning the marker is the operator's
  responsibility. The connector does not place this marker.
- **`methods: []`.** The consumer exposes no `/connect` methods. That
  empty array is part of the public hook contract.
- **Bearer sourcing.** As a sentinel, the loader returns a placeholder
  `apiKey` plus a wrapped `fetch`. The real bearer is sourced from the
  access file on every outbound request via an `Authorization: Bearer …`
  header and never enters plugin arguments, connector stdout/stderr
  diagnostics, or request URLs.
- **No refresh projection.** The consumer access file carries an access token
  only, and consumer code never reads a refresh token. The host observer may
  inspect the host `xai` record only to compute its in-memory fingerprint; it
  never stores, logs, or passes a refresh token in plugin arguments, argv,
  environment, helper invocation, or connector diagnostics.
- **Mode isolation.** Authority and consumer are independent options. The
  consumer runs only through the `/xai` subpath; the authority runs only
  on the host `connectorServer` entry. Omitting `xaiOAuth` disables the
  integration silently. A present `xaiOAuth` with a missing or unknown
  `mode` is rejected at parse time.

## ANTI-PATTERNS

- Writing the guest access file from this connector or shipping tokens
  across machines.
- Minting, refreshing, or rotating xAI OAuth. The connector is a consumer,
  not an authority over tokens.
- Treating `OLLAMA_HOST` or other vendor env vars as alternative access
  sources.
- Caching the access token in module, request, or session state.
- Logging the access file path with a resolved token, including bearer
  bytes in URL queries, or echoing helper argv into diagnostics.
- Returning a consumer hook for an absent or malformed marker, or
  returning a non-empty `methods` array.
- Re-enabling the authority on a relative `XDG_DATA_HOME` or absent `HOME`, or
  treating a missing helper as success instead of retrying the failed launch.
- Replacing closed v1 schema parsing with permissive object access or
  silently accepting an expired `expires`.
