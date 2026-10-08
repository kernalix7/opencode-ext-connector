<div align="center">

# OpenCode External Provider Connector

**One OpenCode plugin configuration reusing existing Claude Code and Command Code credentials, plus a trusted Ollama daemon. No new OAuth login.**

<p>
  <img src="https://img.shields.io/badge/Bun-%3E%3D1.3.14-000000?style=for-the-badge" alt="Bun >=1.3.14" />
  <img src="https://img.shields.io/badge/TypeScript-6.0.2-3178C6?style=for-the-badge" alt="TypeScript 6.0.2" />
  <img src="https://img.shields.io/badge/License-BSD--3--Clause-blue?style=for-the-badge" alt="BSD-3-Clause" />
</p>

**English** · [한국어](docs/README.ko.md) · [Documentation](#documentation)

[Status](#status) · [Requirements](#requirements) · [Quick Install](#quick-install) · [OpenCode V2](#opencode-v2) · [Configuration](#configuration) · [Providers](#providers) · [Host/Guest Sandbox Setup](#hostguest-sandbox-setup) · [Troubleshooting](#troubleshooting) · [Testing](#testing) · [License and Disclaimer](#license-and-disclaimer)

</div>

## Status

> Independent unofficial community plugin, version **0.9.1**. Source is BSD-3-Clause. This project is not affiliated with, endorsed by, sponsored by, or authorized by OpenCode or any provider. Full terms are in [License and Disclaimer](#license-and-disclaimer).

Version 0.9.0 corrected the 0.8 API-only direction: the plugin again reuses existing Claude Code OAuth/keychain/files and Command Code CLI credentials/files or an explicitly selected direct key. Native vendor CLIs are not mandatory for generation, and failures never select an implicit paid API fallback. Explicit standalone API SDKs remain separate and voluntary. Provider ids are `claude`, `command-code`, and `ollama`; all three are enabled by default. Explicit `providers: []` disables those three, independently of opt-in xAI.

Service terms may restrict third-party credential reuse. Compatibility protocols may break and providers may restrict accounts. The source license is not vendor permission; this project guarantees neither free/zero-cost use, billing treatment, live entitlement, nor vendor acceptance.

Cursor is excluded: there is no private-protocol, SDK generation, or CLI fallback. Version 0.9.1 restores the original V1 xAI OAuth consumer through both root and dedicated entries, plus authority observation, superseding its earlier retirement. The consumer is V1-only; opting into consumer mode on V2 produces an explicit setup error before resource allocation. V2 authority observes the selected native connection; external manager compatibility remains unverified.

## Requirements

| Need | Detail |
| --- | --- |
| [Bun](https://bun.sh) | 1.3.14 or later |
| OpenCode V1 | Runtime with the named multi-function plugin loader; `@opencode-ai/plugin@1.18.18` is the compile-time API target, not a runtime pin |
| OpenCode V2 | `@opencode/cli@2.0.20` with `@opencode/plugin@2.0.20`; see [OpenCode V2](#opencode-v2) |
| Claude | Existing Claude Code OAuth credentials in `~/.claude/.credentials.json` (or `CLAUDE_CONFIG_DIR`) and/or macOS Keychain, plus the OpenCode connection gate |
| Command Code | Existing CLI credentials in `~/.commandcode/auth.json` or `COMMAND_CODE_API_KEY`, or an explicitly selected OpenCode direct key |
| Ollama | Trusted daemon, default `http://localhost:11434`; daemon-side Cloud login remains separate |
| Opt-in xAI | Existing authorized session, exact selected connection gate and secure access-only projection; authority additionally needs the external helper/manager described below |

No native vendor generation CLI is required by the default runtime. Client versions resolve dynamically from `ANTHROPIC_CLI_VERSION` / `COMMAND_CODE_CLI_VERSION`, then an optional installed `claude --version` / `command-code --version`, then the npm registry (`@anthropic-ai/claude-code` / `command-code`). They are never a fixed version constant. The opt-in Claude CLI authority has separate prerequisites below.

## Quick Install

For V1, choose global `~/.config/opencode/opencode.json` or project-level `opencode.json`. Use the singular `plugin` field and an exact-version npm tuple:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["opencode-ext-connector@0.9.1", {
      "providers": ["claude", "command-code", "ollama"]
    }]
  ]
}
```

Fully quit and restart OpenCode after changing plugin configuration. Do not put API keys in this file; use OpenCode's protected auth storage or secret-injected environment variables.

### First-time connection

1. Make the existing vendor credentials available to this runtime, then use `/connect`. V1 provider `claude` maps to integration/auth id `anthropic`, with models named `claude/<id>`. Its exact `cli-session:anthropic` gate (or supported OAuth record) requires usable Claude Code credentials. Command Code's `cli-session:command-code` gate requires its vendor credential; an explicitly selected direct key is a separate connection choice, never a vendor-file fallback.
2. For Ollama, start a trusted daemon at `ollamaBaseURL`, then use `/connect` to probe it and store the exact `cli-session:ollama` marker. The marker is not a credential.
3. Restart OpenCode so instance setup picks up the connections and model membership. Confirm the corresponding provider catalogs; for Ollama, use `opencode models ollama`.

Markers are connection gates, not vendor tokens. Ollama requires its exact marker and a responsive configured daemon. Host-bound catalogs and generation remain scoped to the selected gate and credential source; an unrelated native API connection is not a subscription fallback.

### Update and remove

To update, replace the exact npm version in the V1 tuple and restart. For V2, update the built plugin directory described below and restart. Remove the corresponding `plugin` or `plugins` entry to stop loading the connector. Cached package files are inert when not configured.

## OpenCode V2

V2 uses the separate default export and targets `@opencode/cli@2.0.20` and `@opencode/plugin@2.0.20`. An older beta CLI is not a supported target. Other plugins must independently support V2; this connector does not make them V2-compatible.

Build the package locally:

```bash
bun install --frozen-lockfile
bun run build
```

V2 config uses plural `plugins`, with `{ "package", "options" }` objects. Point `package` at the **directory file URL** for `dist/v2-entry`; its `server.js` forwards to the V2 default export:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "file:///absolute/path/to/opencode-ext-connector/dist/v2-entry",
      "options": {
        "providers": ["claude", "command-code", "ollama"],
        "ollamaBaseURL": "http://localhost:11434"
      }
    }
  ]
}
```

The 2.0.20 CLI ignores direct file URLs, including `file:///.../dist/v2.js`. The raw npm subpath `opencode-ext-connector/v2` is not a CLI-resolvable plugin package spec. The root npm spec does not automatically select V2. `opencode-ext-connector/v2` (`./v2`) is a Node import entry; the CLI loads the directory above. Fully quit and restart after changing the configuration.

V2 authenticates only through the selected host connection's `active` / `resolve` result and declared connection methods. It does not read the V1 `auth.json` store or fall back to an alternative process-env connection when the selected connection is absent or unusable. Claude's provider id is `claude`, its integration id is `anthropic`, and its model names are `claude/<id>`.

| Integration | Declared env connection | Resolved value |
| --- | --- | --- |
| `anthropic` | `CLAUDE_EXT_CONNECTOR_ENABLED` | Exact `cli-session:anthropic` gate plus vendor credentials |
| `command-code` | `COMMAND_CODE_API_KEY` | Explicit direct key; CLI connection uses exact `cli-session:command-code` plus vendor credentials |
| `ollama` | `OLLAMA_EXT_CONNECTOR_ENABLED` | Exact `cli-session:ollama` marker |

Declared Claude OAuth/CLI connection methods reuse existing credentials; they do not perform a new login. A marker alone is insufficient. Ollama still requires a responsive trusted daemon. V2 uses the same user options below.

xAI consumer mode is **V1-only**. On native CLI 2.0.20, `/api/experimental/generate` bypasses all session hooks, `nativeModelResolver` ignores SDK hooks, and no auth-factory interceptor is exposed. V2 therefore rejects `xaiOAuth: { mode: "consumer" }` with a typed configuration/setup error before resource allocation. It does not promise native HTTP/WebSocket interception or global fail-closed enforcement of native API requests. When consumer opt-in is unset, independent native xAI API-key use and other V2 providers remain unchanged.

V2 authority observes only the selected native `xai` connection through `active` / `resolve`, including removal and transition to stable absence; it does not use V1 `auth.json` or an unselected env fallback. The separately supplied fixed helper and external manager own projection. Native V2 manager compatibility is unverified; the helper is neither bundled nor installed by this package.

## Configuration

These are the user-facing connector options. In V1 they are the second item of the npm tuple; in V2 they are the object's `options` value.

| Option | Default | Meaning |
| --- | --- | --- |
| `providers` | `["claude", "command-code", "ollama"]` | Strict allow-list of these ids; `[]` disables those three; `cursor` and `xai` are not list members |
| `xaiOAuth` | omitted (disabled) | Independent strict `{ "mode": "authority" }` or `{ "mode": "consumer" }`; consumer is V1-only and explicitly rejected during V2 setup before allocation; missing/invalid modes, null and extra fields are rejected |
| `ollamaBaseURL` | `"http://localhost:11434"` | Absolute `http` or `https` base for a trusted daemon; path prefixes are preserved |
| `credentialRole` | omitted | Claude shared-login `"owner"` or `"reader"`; ownership is independent of host/guest placement |
| `credentialManagement` | omitted | Advanced Claude `"connector"` refresh/writeback or `"external"` never-refresh/no-write |
| `credentialRefresh` | `mode: "auto", leadMs: 60000` | Deprecated; accepted without `credentialManagement` or `credentialRole`, including custom lead times |
| `writeBackCredentials` | `false` | Deprecated; accepted without `credentialManagement` or `credentialRole` |
| `credentialAuthority.claudeCli.enabled` | `false` | Opt-in Linux CLI authority; requires external management |
| `credentialAuthority.claudeCli.leadMs` / `retryMs` | `300000` / `300000` | Authority lead time / retry delay in milliseconds |
| `snapshotTimeoutMs` | `30000` | Per-provider snapshot deadline |
| `catalogReloadMs` | `300000` | Catalog refresh interval; `0` disables only periodic refresh |
| `health.initialBackoffMs` | `1000` | Initial health backoff after a failed snapshot |
| `health.maximumBackoffMs` | `60000` | Health backoff cap; must be at least the initial backoff |

Timer values are integer milliseconds; snapshot and health timers must be positive, and the catalog interval may be zero. One initial catalog refresh always runs. Periodic refreshes are fixed-delay and single-flight. Provider health is isolated: transient failures retain the last-known catalog, while an unavailable snapshot removes only connector-owned provider data.

### Credential ownership and advanced policy

Use `credentialRole: "reader"` for externally managed, read-only shared credentials. It selects external management without CLI authority. Use `credentialRole: "owner"` on exactly one Linux instance per shared Claude login; it selects external management plus the opt-in Claude CLI authority. Roles cannot be combined with `credentialManagement`, `credentialAuthority`, `credentialRefresh`, or `writeBackCredentials`.

Owner/low-level CLI authority requires Linux, util-linux `flock`, Claude Code >=2.1.265, an authenticated session, and writable persistent authority state. Each restricted authority invocation is a real model request and may consume usage. It is not default generation, does not log in, and cannot revive a revoked session. Low-level authority requires `credentialManagement: "external"` and `credentialAuthority: { claudeCli: { enabled: true } }`. Synchronization remains the operator's responsibility; never let independent refreshers share one rotating login.

With all policy options omitted, Claude retains auto refresh with a `60_000` ms lead and no writeback. `credentialManagement: "connector"` selects auto/`60_000` plus writeback; `"external"` selects never-refresh/no-write and allows credential reread after 401. Deprecated `credentialRefresh` and `writeBackCredentials` remain accepted alone for one migration cycle, but cannot be mixed with `credentialManagement`. Command Code stays read-only and Ollama is unaffected. Independent `xaiOAuth` does not alter these Claude policies.

OpenCode builds its active provider registry during instance setup. Catalog refresh does not force instance reconstruction or write generated provider configuration. Restart after changing authentication or model membership.

V1 and V2 captured model views revalidate their gate/selected connection, credential source, catalog membership, generation, and lifetime before dispatch, including internal retries. An unknown externally changed token, account, or source revokes old views and requires a new catalog binding. Only known managed-refresh descendants may retain scope while the source and gate remain current. A pre-output 401 can cause a reread, but an unexplained replacement does not authorize silently retrying the old prompt under a foreign account. Disposal revokes bindings. `connectorV1` is internal metadata, not a user option.

## Providers

### Claude

Reuses existing Claude Code OAuth/keychain/files for CLI-compatible bearer-authenticated Models (`GET /v1/models`) and Messages (`/v1/messages`) requests with compatibility metadata and streamed text/tool events. V1 uses the scoped `anthropic` integration gate; V2 uses only its selected connection.

This compatibility path is unofficial, not a promise of a supported third-party subscription API. Refresh/writeback follows the policy above. Explicit standalone API-key SDK access is a distinct voluntary path; subscription failure never switches to it.

### Command Code

Uses `GET /provider/v1/models` for catalog discovery and CLI-compatible `/alpha/generate` with provider-local NDJSON text/tool events for plugin generation. Reuses existing CLI credentials/files or an explicitly selected direct key. A direct key never triggers vendor-file fallback.

Client metadata uses dynamic version resolution described above; no native generation CLI is mandatory. Credentials remain read-only. Exact pre-output 401 rereads remain subject to account/source revocation, rather than unconditional prompt replay. This unpublished compatibility protocol may change; catalog visibility does not prove entitlement or billing treatment.

### Ollama

Uses `/api/tags`, `/api/pull`, and `/api/chat` on the trusted daemon selected by `ollamaBaseURL`, preserving any path prefix. For example, `https://ollama.example.test/team` yields `https://ollama.example.test/team/api/tags`.

The catalog combines locally pulled models with anonymous global Cloud discovery from the public JSON catalog at `https://ollama.com/api/tags`. That hosted catalog is independent of models installed on your daemon. Each hosted ID must map to a daemon reference verified against official `registry.ollama.ai` manifests and config: an exact `remote_model` match, the approved HTTPS `remote_host` (`https://ollama.com`), matching config size and SHA-256 digest, and zero weight layers (an empty manifest layer list). Local entries win exact duplicates.

The resolver probes bounded candidate reference names; those names are not an approved universal suffix rule or proof of complete mapping. A Cloud refresh succeeds only when every hosted ID resolves to a verified reference. Unresolved mappings or verification failures make the refresh incomplete: the last complete Cloud list and its pull authorizations are retained, rather than publishing a partial replacement. Before any complete refresh, no Cloud references are authorized. Comprehensive mapping and permission for candidate probing remain unresolved review items; metadata verification alone does not establish service permission or live generation success.

A failed discovery cancels its sibling workers and waits for their cleanup before the snapshot finishes, preserving the original failure without cancelling the caller's parent signal. After a first-use pull finishes, each waiting call rechecks its original catalog authorization before sending a prompt; revoked or replaced authorization blocks chat. Models already installed on the trusted daemon retain their local-first behavior without requiring a Cloud catalog lease.

Selecting a verified, catalog-authorized reference absent from the configured daemon triggers an automatic lightweight `/api/pull` there before `/api/chat`. An active catalog lease is required; concurrent pulls share a flight for the same normalized base and reference, and failed pulls can be retried. Within that shared flight, the exact selected reference's manifest/config is reverified against its retained original hosted ID, without substituting another candidate. Authorization is then rechecked for an active lease and unchanged catalog reference before daemon pull; failed verification or no-longer-current authorization prevents the pull. Catalog refresh also rechecks lease disposal and cancellation after discovery before publishing results.

The daemon may proxy Cloud-tag prompts under its own Cloud login. Run `ollama signin` separately on the daemon machine when needed; the connector does not perform that login or copy Ollama credentials.

The connector rejects URL credentials, query strings, fragments, direct API-route bases, and `ollama.com` hosts. It does not read `OLLAMA_HOST`, supply credentials, custom headers or cookies, follow redirects, configure custom CAs, bypass TLS verification, or use direct Cloud generation. Only use a daemon and network path you trust; exposure and access policy are the operator's responsibility.

### Opt-in xAI authority and V1 consumer

Omitting `xaiOAuth` disables xAI silently. Choose exactly `{ "mode": "authority" }` or `{ "mode": "consumer" }`; literal null, missing/unknown modes and extra keys fail parsing. xAI is separate from `providers` and Claude's credential role/policy. To use only xAI through the V1 root, disable the three catalog providers explicitly:

```jsonc
{
  "plugin": [["opencode-ext-connector@0.9.1", {
    "providers": [],
    "xaiOAuth": { "mode": "consumer" }
  }]]
}
```

On the credential-observing instance, use the root tuple with `xaiOAuth: { mode: "authority" }` instead. Authority observes existing auth changes and invokes only `${HOME}/.local/bin/opensandbox-xai-auth-sync`, with no arguments. Child env is limited to absolute `HOME`, `PATH=/usr/local/bin:/usr/bin:/bin` and absolute `XDG_DATA_HOME` when supplied. Polling defaults to 1000 ms; failed observation/helper launch or non-zero exit retries after 5000 ms. Disposal cancels polling and supervised work. V1 observes its existing `xai` auth record; V2 observes the selected native `active` / `resolve` source, including removal into stable absence.

The external manager owns projection and session management. The package neither bundles nor installs the helper, writes access files, mirrors secrets, mints new OAuth grants nor refreshes xAI tokens. The actual helper is not present in the validation environment; native V2 manager compatibility has not been verified. Never transfer refresh tokens to a guest.

The consumer requires exactly `{ "type": "api", "key": "cli-session:xai" }` in V1. This marker is operator-provisioned, not a real API credential. Its loader returns the sentinel `apiKey: "xai-access-file"` plus a wrapped request transport; `methods: []` exposes no new login or `/connect` method. A real native API key is a separate voluntary connection, never an implicit fallback.

The access source is `${XDG_DATA_HOME}/opencode/xai-access.json` when XDG data home is absolute, otherwise `${HOME}/.local/share/opencode/xai-access.json` when XDG is unset/empty and HOME is absolute. Relative XDG paths fail closed. The closed v1 schema accepts only `schema_version: 1`, `provider: "xai"` and either `state: "ready"` with nonempty `access` and integer `expires` (epoch milliseconds), or `state: "unavailable"`. Extra fields, including refresh tokens, fail parsing. The file must be owned by the current user, regular, single-link and exactly `0600`, opened read-only/no-follow; missing, linked, malformed, unavailable or expired state blocks before network dispatch.

Every fresh V1 request rereads the projection, so the same loader can use access A and then updated access B on the next fresh request. A paused attempt remains bound to its original path, token fingerprint, expiry, selected gate and lifetime; observed drift blocks it rather than adopting a replacement or replaying its prompt. Trusted xAI targets, cancellation and disposal are rechecked before dispatch; redirects are rejected. There is no 401 prompt replay, connector refresh, new grant or paid fallback.

The dedicated `./xai` Node entry exposes only `xaiAuthServer`:

```ts
import { xaiAuthServer } from "opencode-ext-connector/xai"
```

Its raw npm subpath is not verified as a V1 plugin-loader spec; use the root npm tuple above for V1 configuration. V2 authority uses the plural `plugins` directory URL contract above, with `xaiOAuth: { mode: "authority" }` in `options`; V2 consumer mode is rejected during setup.

### Package entry points and retired Cursor

The root and `./server` are **V1-only** and retain exactly six named functions: `connectorServer`, `claudeAuthServer`, `cursorAuthServer`, `commandCodeAuthServer`, `ollamaAuthServer`, and `xaiAuthServer`. Cursor remains inert. The restoration makes root `xaiAuthServer` functional only in consumer mode; root `connectorServer` owns authority observation in authority mode.

| Entry | Behavior |
| --- | --- |
| `opencode-ext-connector/claude` | Added `createClaude` standalone LanguageModelV3 SDK factory |
| `opencode-ext-connector/command-code` | `createCommandCode` standalone LanguageModelV3 SDK factory |
| `opencode-ext-connector/ollama` | Standalone SDK with `{ ollamaBaseURL }`; Cloud auto-pull requires an active catalog lease for that normalized base |
| `opencode-ext-connector/cursor` | Generation unavailable; requesting a language model throws `CursorRetiredError`, with no private-protocol or CLI fallback |
| `opencode-ext-connector/xai` | Restored dedicated Node consumer entry exposing only `xaiAuthServer`; opt-in consumer mode, exact marker, secure projection and `methods: []` |
| `opencode-ext-connector/v2` | Separate V2 Node import entry; CLI setup uses `dist/v2-entry` |

Standalone Claude and Command Code API SDKs remain separate, explicitly selected and voluntary. They do not supply a fallback for host-bound compatibility generation. For standalone use, pass an explicit API key from your secret mechanism, not from committed configuration:

```ts
import { createClaude } from "opencode-ext-connector/claude"

const claude = createClaude({ apiKey: process.env.ANTHROPIC_API_KEY })
// Use a model id returned by the official catalog.
const model = claude.languageModel(modelId)
```

## Host/Guest Sandbox Setup

The normal host and a container/VM/sandbox guest use the same credential-based contract. The guest has its own HOME, environment, permissions, keychain and network namespace. For shared logins, mount only the required vendor credential sources read-only, use Claude `credentialRole: "reader"` in readers, and keep exactly one refresh owner per shared login. A host macOS Keychain is not available inside a Linux guest; provide a suitable credential file rather than assuming keychain access.

Mount the Claude credential directory and set guest `CLAUDE_CONFIG_DIR` to that path; mount Command Code credentials read-only at the guest's `${HOME}/.commandcode/auth.json`, or explicitly inject its selected key through the sandbox secret mechanism. Resolve client versions with env overrides, optional installed binaries, or npm registry access. Do not copy Ollama credentials; Cloud login belongs to the selected daemon.

Give the guest a separate persistent `HOME` and writable `XDG_DATA_HOME`, for example:

```dotenv
HOME=/home/sandbox
XDG_DATA_HOME=/home/sandbox/.local/share
CLAUDE_CONFIG_DIR=/run/host-credentials/claude
```

Never put tokens or keys in `opencode.json`. Give the guest a separate writable, persistent, protected OpenCode auth store, not a read-only mount of the host's entire OpenCode data directory. On Linux, V1 storage is `${XDG_DATA_HOME}/opencode/auth.json`, or `${HOME}/.local/share/opencode/auth.json` when XDG data home is unset. It may contain OAuth records or direct keys and must be protected as secret-bearing storage. Complete `/connect` inside that runtime. V2 uses host-managed selected connections rather than the V1 store.

Guest `localhost` is not the host. To reach a trusted host Ollama daemon, use an explicit host route:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["opencode-ext-connector@0.9.1", {
      "providers": ["claude", "command-code", "ollama"],
      "ollamaBaseURL": "http://host.docker.internal:11434",
      "credentialRole": "reader"
    }]
  ]
}
```

Docker Desktop normally resolves `host.docker.internal`. Linux Docker bridge networking may need `--add-host=host.docker.internal:host-gateway`, or this Compose mapping:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

The daemon must listen on an address reachable from that guest. The operator is responsible for its bind address, firewall, sandbox egress, and network trust; restrict daemon exposure to intended clients. Host networking reduces isolation and should be an explicit choice. Other VM/sandbox runtimes need an equivalent host route. Cloud login remains on the daemon machine; no Ollama credential belongs in the guest connector.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| V1 `/connect` methods missing | Use the singular `plugin` npm tuple and fully restart OpenCode |
| V2 plugin not loaded | Use the plural `plugins` object with the directory file URL for `dist/v2-entry`; direct `v2.js` URLs and raw `/v2` npm specs do not load it |
| Claude or Command Code has no models | Check the allow-list, exact integration gate and usable vendor credential (or selected Command Code direct key); restart after connection changes |
| V2 connection unavailable despite a process env key | Check the selected host connection and its resolved value; there is no fallback to a different env connection or V1 store |
| Credential policy rejected | Do not mix roles with low-level policy or management with deprecated refresh/writeback; `xaiOAuth` accepts only the independent strict authority/consumer object |
| Client version unavailable | Set the provider's version env override, provide an optional installed binary, or allow npm registry access |
| Shared Claude login stops refreshing | Check the sole owner, synchronized files, Linux/flock/CLI prerequisites and revoked login state; authority requests may consume usage |
| Cursor unavailable | Cursor is excluded; use another supported provider |
| xAI projection unavailable | Check consumer mode, exact selected marker, absolute XDG/HOME, owned single-link `0600` file, closed schema and future expiry; no login or 401 replay is offered |
| xAI consumer rejected on V2 | Consumer is V1-only; use the V1 root tuple or dedicated Node entry. V2 rejects consumer setup before allocation |
| xAI authority helper unavailable | Supply the external fixed helper/manager separately; failed launches retry, not success. Native V2 selected-source manager compatibility remains unverified |
| Retained model stops working | Obtain a fresh catalog binding after an unknown token/account/source, gate, generation, membership or lifetime change; do not replay an old prompt under a replacement account |
| Ollama works on the host but not in the guest | Check the host route, host-gateway mapping, daemon bind address, firewall, egress, and base path prefix |
| Ollama Cloud generation fails | Check daemon-side Cloud login and plan access; the connector supplies no Cloud credential |
| One provider is down | Provider failures are isolated; check its authentication, endpoint access, and snapshot health |

## Documentation

| Document | Contents |
| --- | --- |
| [docs/README.ko.md](docs/README.ko.md) | Korean README |
| [CHANGELOG.md](CHANGELOG.md) | Release notes |
| [LICENSE](LICENSE) | BSD 3-Clause License |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | Derived upstream work |

## Testing

```bash
bun run check
bun run build
bun test
bun run test:provider
bun run test:integration
bun run test:e2e
OPENCODE_V2_BIN=/path/to/v2-binary bun run test:e2e:v2
bun run verify:package
```

`check` covers lint, TypeScript, source policy, file-size policy, and foundation tests. `test:e2e` is the V1 lane; the explicit V2 lane targets `@opencode/cli@2.0.20`. `verify:package` is a dry-run package pack.

Tests use deterministic offline credential/transport fakes and loopback endpoints, including real isolated OpenCode host processes under temporary HOME/XDG directories. They must not inherit host credentials or call live vendor endpoints. These checks are not live vendor proof, entitlement evidence, or billing guarantees.

After the V2 boundary correction, the parent's `bun run check` passed with exit 0, and the full suite passed with 753 tests, 0 failures, 129 files and 1951 assertions. Consumer QA through the built root and dedicated public entries and production-supervised synthetic-helper initial/change/removal QA passed on Bun 1.3.14 and Node 24.20.0, without live vendor calls. Detailed source-freeze, packed-package, CI and registry evidence is maintained in the external parent release ledger.

`bun test` skips the V2 lane when `OPENCODE_V2_BIN` is unset and `opencode2` is absent. `bun run test:e2e:v2` defaults the variable to `opencode2` and fails rather than quietly skipping when its binary is missing.

## License and Disclaimer

BSD-3-Clause. See [LICENSE](LICENSE). Derived upstream work is listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

This is an independent and unofficial community project. It is not affiliated
with, endorsed by, sponsored by, or authorized by OpenCode or any third-party
service provider.

All product names, trademarks, and registered trademarks belong to their
respective owners. Their use in this project is solely for identification and
interoperability purposes and does not imply any affiliation or endorsement.

The license for this project applies only to the source code distributed in
this repository. It does not grant any right or permission to access, use,
modify, automate, or bypass restrictions imposed by third-party services.

This project is not intended to encourage circumvention of access controls,
usage restrictions, authentication requirements, or terms of service. Users
are solely responsible for determining whether their use is permitted and for
complying with all applicable laws, agreements, policies, and provider terms.

Third-party providers may change, restrict, suspend, or terminate their
interfaces, authentication mechanisms, accounts, or services at any time.
Using this software may result in service interruption, account restriction or
termination, data loss, unexpected charges, or credential exposure.

This software is provided "as is" and without warranties of any kind. To the
maximum extent permitted by applicable law, the authors and contributors are
not liable for any claim, damage, loss, account action, or other consequence
arising from the use or inability to use this software. Use this software
entirely at your own risk.

The BSD 3-Clause License in [LICENSE](LICENSE) governs the copying,
modification, and distribution of this software. If this disclaimer conflicts
with the license, the license controls.
