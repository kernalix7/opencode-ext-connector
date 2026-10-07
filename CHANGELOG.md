# Changelog

## 0.9.0 - 2026-10-07

- Correct the 0.8 API-only direction by restoring the original existing-credential
  plugin purpose: Claude Code OAuth/keychain/files and Command Code CLI
  credentials/files or an explicitly selected direct key. No mandatory native
  generation CLI and no implicit paid API fallback; standalone API SDKs remain
  separate and voluntary. This correction does not imply user approval of 0.8.
- Restore scoped V1 `claude` provider → `anthropic` integration gates and exact
  CLI-session markers plus vendor credentials. V2 uses only selected `active` /
  `resolve`, without V1-store or alternative process-env fallback.
- Restore Claude-compatible bearer Models/Messages and Command Code
  `GET /provider/v1/models` plus `/alpha/generate` NDJSON. Resolve client versions
  dynamically from env, optional installed `--version`, then npm; never constants.
- Restore Claude owner/reader and low-level credential policy: omitted auto/
  `60_000` without writeback, connector auto/writeback, external never/no-write.
  One Linux owner per shared login may opt into the flock-coordinated Claude CLI
  authority (>=2.1.265); its real request may consume usage. Readers remain
  external without authority; roles exclude low-level policy, while deprecated
  refresh/writeback remain accepted alone. `xaiOAuth` remains rejected.
- Retain account/source/gate/lifetime isolation. Unknown external token, account,
  or source replacement revokes old model views and requires fresh catalog binding;
  only known managed-refresh descendants may retain scope. Do not silently replay
  an old prompt under a replacement account. Restore read-only host credential
  mounts/readers with separate protected writable guest OpenCode auth storage.
- Keep the three-provider default, Cursor exclusion, xAI retirement, six V1 root/
  server exports, separate V2 default and CLI 2.0.20 `dist/v2-entry` directory loader.
- Preserve global Ollama JSON discovery, exact manifest/config/digest/remote-host/
  zero-layer proof, exact selected-reference pre-pull revalidation, trusted-daemon
  auto-pull/chat, local-first behavior, leases, cancellation and last-complete
  refresh retention. No static Cloud list or direct Cloud credential fallback.
- Preserve unofficial branding, attribution and full bilingual disclaimers.
  Third-party credential reuse may be restricted by service terms; protocols may
  break and accounts may be restricted. Source licensing is not vendor permission.
  Offline fakes and isolated real host/loopback tests do not prove live entitlement,
  vendor acceptance, zero-cost use or billing treatment.

## 0.8.0 - 2026-10-01

- Migrate Claude and Command Code to official API-key integrations and SDKs.
  Claude uses a dedicated `claude` connection; Command Code routes only through
  endpoints advertised by its official Provider API catalog.
- Exclude Cursor until a supported, permission-safe model integration is
  established. Remove its private protocol, child bridge, and CLI-token reuse.
- Retire consumer OAuth, CLI identity compatibility, refresh/writeback,
  credential authority helpers, and xAI access projection. Reject their old
  options explicitly; xAI API keys use OpenCode's native provider.
- Preserve the six named V1 root exports with inactive Cursor/xAI root hooks;
  retain explicit retirement errors on their dedicated entries.
- Add the `./claude` SDK entry and generation-bound V1 model views. Changed
  credentials and owner disposal invalidate cached host models; standalone
  explicit API keys remain supported without ambient fallback.
- Add the separate V2 default plugin for Claude, Command Code, and Ollama,
  targeting `@opencode/plugin` and private CLI `2.0.20`.
- Add the V1-only `./server` alias, Node-only `./v2` import, and the local
  `dist/v2-entry` directory facade required by the V2 CLI loader.
- Add isolated V2 lifecycle, routing, auth, packed-package, and local-generation
  regressions; require the pinned private V2 CLI lane before release packing.
- Keep trusted Ollama daemon behavior and document API billing, breaking
  configuration changes, and ordinary-host/container secret provisioning.
- Replace Ollama Cloud HTML discovery with the public global JSON catalog at
  `https://ollama.com/api/tags`, independent of locally installed models. Verify
  candidate daemon references through official registry manifests/config with
  exact hosted IDs, the approved HTTPS remote host, config size/digest checks,
  and zero weight layers. Require a complete refresh and retain the last complete
  Cloud list on unresolved mappings; candidate names do not establish a universal
  suffix contract or comprehensive mapping/permission. Preserve automatic
  lightweight pull of absent verified, catalog-authorized references on the
  configured daemon, with generation/auth remaining daemon-side. Reverify the
  exact selected manifest/config against retained original hosted-ID provenance
  in the shared pull flight, without alternate-candidate substitution; then
  recheck active lease and unchanged reference authorization before daemon pull.
  Recheck lease disposal and cancellation after discovery before publishing a
  catalog refresh.
- Cancel and join sibling Cloud discovery workers on failure, and recheck each
  first-use caller's original catalog authorization after pull before chat.
  Preserve shared-pull cancellation and already-installed local-model behavior.

## 0.7.1 - 2026-09-23

- Restrict the `credentialAuthority` schema to a strict, deeply-frozen Claude CLI
  object: unknown keys fail parsing, empty input normalizes to disabled defaults
  with `leadMs: 300_000` and `retryMs: 300_000`, and only `claudeCli` is accepted
- Strip `ANTHROPIC_API_KEY` from every Claude authority child invocation so the
  stored OAuth login is always used regardless of any in-memory key, without
  mutating the parent environment
- Attempt every disposer on shutdown through `Promise.allSettled` and keep the
  Claude authority failure as the primary error so the xAI authority, supervisor,
  and runtime disposers still run alongside Claude while Claude stays primary

## 0.7.0 - 2026-09-23

- Add the opt-in `xaiOAuth.mode: "authority" | "consumer"` package subpath
  pairing a host-side authority with a guest-side consumer; omitting
  `xaiOAuth` disables the integration silently, while a present `xaiOAuth`
  whose `mode` is missing or unknown is rejected at parse time
- Ship the dedicated `./xai` consumer as a separate OpenCode plugin entry
  that returns the xAI auth hook only with `methods: []`
- Invoke the fixed helper at `${HOME}/.local/bin/opensandbox-xai-auth-sync`
  with no arguments, `PATH=/usr/local/bin:/usr/bin:/bin`, `HOME` always
  set, and `XDG_DATA_HOME` forwarded only when absolute; the helper
  delegates projection to the OpenSandbox manager, and a non-zero exit
  retries after `5000` ms without removing the xAI provider
- Re-read the access file and `expires` on every outbound request and raise
  `XaiAccessUnavailableError` before any network call on a missing file,
  a stat that fails the closed-v1 `0600`/single-link/current-user gates,
  a schema mismatch, a `"state": "unavailable"` record, malformed JSON,
  or a non-future `expires`
- Never place a refresh token inside the guest; refresh stays on the host
  authority only
- Keep existing Claude, Cursor, Command Code, and Ollama providers and
  omitted-mode behavior unchanged

## 0.6.0 - 2026-09-16

- Add the recommended `credentialRole: "owner" | "reader"` option for shared
  Claude logins: one Linux owner runs the existing Claude CLI authority while
  readers consume externally managed credentials without refreshing them
- Keep the existing low-level credential policy options available for advanced
  control, but reject combining any of them with `credentialRole`
- Keep omitted credential policy behavior and non-Claude providers unchanged

## 0.5.0 - 2026-09-15

- Add the disabled-by-default Claude CLI credential authority for Linux
  deployments using `credentialManagement: "external"`
- Schedule one restricted Claude Code request before credential expiry, with
  process-shared `flock` coordination, retry handling, and clean shutdown
- Require util-linux `flock` and Claude Code `2.1.259` or later when enabled;
  each invocation is a real model request and may consume account usage
- Keep OAuth, credential persistence, and other providers unchanged; revoked
  Claude sessions still require interactive `/login`

## 0.4.0 - 2026-09-11

- Add explicit `ollamaBaseURL` support for trusted remote and self-hosted Ollama
  daemons across plugin options, `/connect`, provider projection, runtime, and
  the `opencode-ext-connector/ollama` SDK entry
- Preserve daemon path prefixes, isolate process state by normalized base URL,
  and reject Cloud hosts, credentials, redirects, and ambiguous URL forms
- Add the preferred connector-wide `credentialManagement: "connector" |
  "external"` authority policy, capability-gated by each provider adapter
- Map Claude `"connector"` to automatic refresh with a `60_000` ms lead and
  writeback, and `"external"` to never-refresh/no-write with credential re-read
  after 401; omitting all credential-policy options preserves automatic refresh
  with a `60_000` ms lead and no writeback, while legacy options still control
  behavior when supplied without `credentialManagement`
- Keep Cursor direct generation and Command Code read-only under both modes:
  on an exact HTTP 401 before output or effects, re-read only a changed,
  non-null credential and retry once; this is neither refresh nor writeback.
  Cursor legacy/compatibility generation remains one-shot; leave Ollama
  unaffected
- Reject combining `credentialManagement` with `credentialRefresh` or
  `writeBackCredentials`; accept those legacy options alone as deprecated for
  one migration cycle, with custom lead times still using the legacy config

## 0.3.3 - 2026-09-06

- Document official npm package installation through OpenCode's `plugin` field,
  including pinned installs, deterministic updates, and removal guidance
- Maintain active branch history by removing obsolete commit attribution
  trailers while preserving source trees; existing published tags and
  provenance remain unchanged
- Exercise package loading through the exact npm package spec from an isolated
  offline OpenCode cache with no registry access
- Harden npm publishing with immutable action and toolchain pins, a no-OIDC
  verification job, and a checksummed tarball-only OIDC publish job
- Keep provider and runtime behavior unchanged

## 0.3.2 - 2026-09-06

- Remove the obsolete npm token fallback so releases publish only through
  GitHub Actions OIDC trusted publishing
- Keep provider behavior unchanged

## 0.3.1 - 2026-09-05

- Fix Node ESM compatibility for root and SDK subpath imports by using explicit
  `.js` extensions in emitted relative specifiers
- Enforce NodeNext module resolution in the build and cover Node consumers of
  the packed artifact

## 0.3.0 - 2026-09-05

- Publish releases to npm from GitHub Actions when a `v*` tag is pushed; the
  tag must match `package.json`
- Claude and Command Code no longer require their vendor CLI where OpenCode
  runs: the client version comes from `ANTHROPIC_CLI_VERSION` /
  `COMMAND_CODE_CLI_VERSION`, an installed binary, or the latest version
  published on the npm registry; nothing is pinned in the package
- The Claude auth loader now takes over the `anthropic` provider whenever
  credentials exist instead of silently yielding when `claude` is missing
- Added `credentialRefresh: { mode: "auto" | "never", leadMs }` so one machine
  can own Claude token refresh while copies of the credential file stay
  read-only and re-read the file after a 401

## 0.2.0 - 2026-09-04

- Added Ollama as a fourth provider using the local daemon and existing
  `ollama signin` Cloud subscription session
- Added automatic Cloud-only online catalog refresh, pulled-local model
  discovery, local-first deduplication, and pull-on-first-use for Cloud tags
- Added `ollamaAuthServer` and the `opencode-ext-connector/ollama` SDK export
- **Breaking:** Removed the `opencode-ext-connector/server` package subpath;
  import the named plugin functions from `opencode-ext-connector` instead
- Documented the direct `dist/index.js` plugin URL required for all named auth
  hooks
- Cursor direct generation now uses a plugin-owned private Node >=22 child over
  stdio and Cursor's unpublished AgentService Connect+protobuf/HTTP/2 protocol;
  there is no plugin listening daemon and no `cursor-agent` generation fallback

## 0.1.0 - 2026-08-20

- OpenCode plugin exposing Claude, Cursor, and Command Code from existing CLI logins
- Live model catalogs (Anthropic `/v1/models`, `cursor-agent models`, Command Code `/provider/v1/models`)
- Claude OAuth refresh. Optional writeback (`writeBackCredentials: true`) to Claude files, macOS Keychain, and OpenCode `auth.json`
- Cursor process pool, tool-call stream parts, `--resume`, `--list-models` fallback
- Command Code `/alpha/generate` CLI fingerprint request and NDJSON tool/text stream
- Catalog reload interval and process-exit dispose
