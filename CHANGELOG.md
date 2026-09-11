# Changelog

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
