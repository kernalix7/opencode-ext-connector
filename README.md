<div align="center">

# OpenCode External Provider Connector

**One OpenCode plugin configuration for Claude and Command Code official APIs, plus a trusted Ollama daemon.**

<p>
  <img src="https://img.shields.io/badge/Bun-%3E%3D1.3.14-000000?style=for-the-badge" alt="Bun >=1.3.14" />
  <img src="https://img.shields.io/badge/TypeScript-6.0.2-3178C6?style=for-the-badge" alt="TypeScript 6.0.2" />
  <img src="https://img.shields.io/badge/License-BSD--3--Clause-blue?style=for-the-badge" alt="BSD-3-Clause" />
</p>

**English** · [한국어](docs/README.ko.md) · [Documentation](#documentation)

[Status](#status) · [Requirements](#requirements) · [Quick Install](#quick-install) · [OpenCode V2](#opencode-v2) · [Configuration](#configuration) · [Providers](#providers) · [Host/Guest Sandbox Setup](#hostguest-sandbox-setup) · [Troubleshooting](#troubleshooting) · [Testing](#testing) · [License and Disclaimer](#license-and-disclaimer)

</div>

## Status

> Independent unofficial community plugin, version **0.8.0**. Source is BSD-3-Clause. This project is not affiliated with, endorsed by, sponsored by, or authorized by OpenCode or any provider. Full terms are in [License and Disclaimer](#license-and-disclaimer).

Version 0.8.0 uses official API-key access for Claude and Command Code and the configured trusted daemon for Ollama. Provider ids are `claude`, `command-code`, and `ollama`; all three are enabled by default. Explicit `providers: []` disables all.

Cursor is excluded: there is no private-protocol, SDK generation, or CLI fallback. The xAI OAuth projection is retired; use native OpenCode `xai` API-key authentication instead.

## Requirements

| Need | Detail |
| --- | --- |
| [Bun](https://bun.sh) | 1.3.14 or later |
| OpenCode V1 | Runtime with the named multi-function plugin loader; `@opencode-ai/plugin@1.18.18` is the compile-time API target, not a runtime pin |
| OpenCode V2 | `@opencode/cli@2.0.20` with `@opencode/plugin@2.0.20`; see [OpenCode V2](#opencode-v2) |
| Claude | Anthropic API key in the dedicated OpenCode `claude` API record or `ANTHROPIC_API_KEY` |
| Command Code | Dedicated OpenCode `command-code` API key or `COMMAND_CODE_API_KEY`, with official API access |
| Ollama | Trusted daemon, default `http://localhost:11434`; daemon-side Cloud login remains separate |

No vendor CLI or subscription credential files are required. Claude API usage is billed separately from Claude subscriptions. Command Code official API access is available on all plans except Go; billing and credits depend on the plan.

## Quick Install

For V1, choose global `~/.config/opencode/opencode.json` or project-level `opencode.json`. Use the singular `plugin` field and an exact-version npm tuple:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["opencode-ext-connector@0.8.0", {
      "providers": ["claude", "command-code", "ollama"]
    }]
  ]
}
```

Fully quit and restart OpenCode after changing plugin configuration. Do not put API keys in this file; use OpenCode's protected auth storage or secret-injected environment variables.

### First-time connection

1. Provide the API keys in the runtime where OpenCode runs, or use `/connect` to save dedicated `claude` and `command-code` API records. A Claude Code OAuth record, an `anthropic` subscription login, or a CLI-session marker is not a Claude API key.
2. For Ollama, start a trusted daemon at `ollamaBaseURL`, then use `/connect` to probe it and store the exact `cli-session:ollama` marker. The marker is not a credential.
3. Restart OpenCode so instance setup picks up the connections and model membership. Confirm the corresponding provider catalogs; for Ollama, use `opencode models ollama`.

The V1 API record takes precedence over its provider's environment key. Models are discovered from live catalogs, without guessed model ids.

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

V2 authenticates only through the selected host connection's `active` / `resolve` result: a key connection or a declared env connection resolved by the host. It does not read the V1 `auth.json` store or fall back to another environment key when that selected connection is absent or unusable. Claude's provider and integration id are both `claude`, with models named `claude/<id>`.

| Integration | Declared env connection | Resolved value |
| --- | --- | --- |
| `claude` | `ANTHROPIC_API_KEY` | API key |
| `command-code` | `COMMAND_CODE_API_KEY` | API key |
| `ollama` | `OLLAMA_EXT_CONNECTOR_ENABLED` | Exact `cli-session:ollama` marker |

OAuth connections and CLI-session markers for Claude or Command Code are not accepted. Ollama still requires a responsive trusted daemon. V2 uses the same user options below.

## Configuration

These are the user-facing connector options. In V1 they are the second item of the npm tuple; in V2 they are the object's `options` value.

| Option | Default | Meaning |
| --- | --- | --- |
| `providers` | `["claude", "command-code", "ollama"]` | Strict allow-list of these ids; `[]` disables all; `cursor` is unsupported |
| `ollamaBaseURL` | `"http://localhost:11434"` | Absolute `http` or `https` base for a trusted daemon; path prefixes are preserved |
| `snapshotTimeoutMs` | `30000` | Per-provider snapshot deadline |
| `catalogReloadMs` | `300000` | Catalog refresh interval; `0` disables only periodic refresh |
| `health.initialBackoffMs` | `1000` | Initial health backoff after a failed snapshot |
| `health.maximumBackoffMs` | `60000` | Health backoff cap; must be at least the initial backoff |

Timer values are integer milliseconds; snapshot and health timers must be positive, and the catalog interval may be zero. One initial catalog refresh always runs. Periodic refreshes are fixed-delay and single-flight. Provider health is isolated: transient failures retain the last-known catalog, while an unavailable snapshot removes only connector-owned provider data.

**Migration from older configurations:** `credentialRole`, `credentialManagement`, `credentialAuthority`, `credentialRefresh`, `writeBackCredentials`, and `xaiOAuth` are retired and explicitly rejected, including when used alone. Remove them and configure dedicated API-key connections. There is no owner/reader mode, OAuth refresh, authority timer, or credential writeback.

OpenCode builds its active provider registry during instance setup. Catalog refresh does not force instance reconstruction or write generated provider configuration. Restart after changing authentication or model membership.

V1 host-bound language models are revoked when the effective API key, catalog generation, or model membership changes, or when the connector is disposed. A retained model cannot continue using an obsolete host binding. `connectorV1` is internal binding metadata, not a user option; standalone SDK calls support explicit `apiKey` options.

## Providers

### Claude

Uses Anthropic's official Messages API (`/v1/messages`) and paginated Models API (`GET /v1/models`), authenticated with `x-api-key`. V1 reads the dedicated `claude` API record or `ANTHROPIC_API_KEY`; V2 uses its selected host connection.

It does not read Claude Code OAuth, keychain entries, or credential files, invoke a CLI authority, refresh OAuth tokens, or write credentials back. A Claude subscription does not cover this API usage; API billing is separate.

### Command Code

Uses the documented `GET /provider/v1/models` catalog and each model's `supported_endpoints` to select `/provider/v1/chat/completions`, `/provider/v1/messages`, or `/provider/v1/responses`. V1 reads the dedicated `command-code` API record or `COMMAND_CODE_API_KEY`; V2 uses its selected host connection.

There is no `/alpha/generate`, CLI identity/version discovery, CLI credential-file reuse, or guessed Qwen fallback. Official API access is available on all plans except Go, with billing and credits governed by the plan.

### Ollama

Uses `/api/tags`, `/api/pull`, and `/api/chat` on the trusted daemon selected by `ollamaBaseURL`, preserving any path prefix. For example, `https://ollama.example.test/team` yields `https://ollama.example.test/team/api/tags`.

The catalog combines locally pulled models with anonymous global Cloud discovery from the public JSON catalog at `https://ollama.com/api/tags`. That hosted catalog is independent of models installed on your daemon. Each hosted ID must map to a daemon reference verified against official `registry.ollama.ai` manifests and config: an exact `remote_model` match, the approved HTTPS `remote_host` (`https://ollama.com`), matching config size and SHA-256 digest, and zero weight layers (an empty manifest layer list). Local entries win exact duplicates.

The resolver probes bounded candidate reference names; those names are not an approved universal suffix rule or proof of complete mapping. A Cloud refresh succeeds only when every hosted ID resolves to a verified reference. Unresolved mappings or verification failures make the refresh incomplete: the last complete Cloud list and its pull authorizations are retained, rather than publishing a partial replacement. Before any complete refresh, no Cloud references are authorized. Comprehensive mapping and permission for candidate probing remain unresolved review items; metadata verification alone does not establish service permission or live generation success.

A failed discovery cancels its sibling workers and waits for their cleanup before the snapshot finishes, preserving the original failure without cancelling the caller's parent signal. After a first-use pull finishes, each waiting call rechecks its original catalog authorization before sending a prompt; revoked or replaced authorization blocks chat. Models already installed on the trusted daemon retain their local-first behavior without requiring a Cloud catalog lease.

Selecting a verified, catalog-authorized reference absent from the configured daemon triggers an automatic lightweight `/api/pull` there before `/api/chat`. An active catalog lease is required; concurrent pulls share a flight for the same normalized base and reference, and failed pulls can be retried. Within that shared flight, the exact selected reference's manifest/config is reverified against its retained original hosted ID, without substituting another candidate. Authorization is then rechecked for an active lease and unchanged catalog reference before daemon pull; failed verification or no-longer-current authorization prevents the pull. Catalog refresh also rechecks lease disposal and cancellation after discovery before publishing results.

The daemon may proxy Cloud-tag prompts under its own Cloud login. Run `ollama signin` separately on the daemon machine when needed; the connector does not perform that login or copy Ollama credentials.

The connector rejects URL credentials, query strings, fragments, direct API-route bases, and `ollama.com` hosts. It does not read `OLLAMA_HOST`, supply credentials, custom headers or cookies, follow redirects, configure custom CAs, bypass TLS verification, or use direct Cloud generation. Only use a daemon and network path you trust; exposure and access policy are the operator's responsibility.

### Package entry points and retired integrations

The root and `./server` are **V1-only** and retain exactly six named functions: `connectorServer`, `claudeAuthServer`, `cursorAuthServer`, `commandCodeAuthServer`, `ollamaAuthServer`, and `xaiAuthServer`. The root Cursor and xAI functions are inert compatibility exports; they do not register integrations.

| Entry | Behavior |
| --- | --- |
| `opencode-ext-connector/claude` | Added `createClaude` standalone LanguageModelV3 SDK factory |
| `opencode-ext-connector/command-code` | `createCommandCode` standalone LanguageModelV3 SDK factory |
| `opencode-ext-connector/ollama` | Standalone SDK with `{ ollamaBaseURL }`; Cloud auto-pull requires an active catalog lease for that normalized base |
| `opencode-ext-connector/cursor` | Generation unavailable; requesting a language model throws `CursorRetiredError`, with no private-protocol or CLI fallback |
| `opencode-ext-connector/xai` | Retired OAuth projection entry; invoking its dedicated plugin throws `XaiOAuthRetiredError`, while a bare module import does not; use native OpenCode `xai` API keys |
| `opencode-ext-connector/v2` | Separate V2 Node import entry; CLI setup uses `dist/v2-entry` |

For standalone Claude or Command Code SDK use, pass an explicit API key from your secret mechanism, not from committed configuration:

```ts
import { createClaude } from "opencode-ext-connector/claude"

const claude = createClaude({ apiKey: process.env.ANTHROPIC_API_KEY })
// Use a model id returned by the official catalog.
const model = claude.languageModel(modelId)
```

## Host/Guest Sandbox Setup

On a normal desktop, provide API keys to that OpenCode runtime through native protected auth storage or secret-injected environment variables. In a container, sandbox, or VM, the guest runtime needs its own available API keys and writable auth storage. Do not mount vendor subscription credentials or copy Claude Code, Cursor, Command Code CLI, or xAI OAuth session files.

Give the guest a separate persistent `HOME` and writable `XDG_DATA_HOME`, for example:

```dotenv
HOME=/home/sandbox
XDG_DATA_HOME=/home/sandbox/.local/share
```

Inject `ANTHROPIC_API_KEY` and `COMMAND_CODE_API_KEY` through the runtime's secret mechanism, or save dedicated keys through OpenCode's native connection flow. Never put keys in `opencode.json`. On Linux, V1 auth storage is `${XDG_DATA_HOME}/opencode/auth.json`, or `${HOME}/.local/share/opencode/auth.json` when XDG data home is unset. This store can contain API keys: protect it as secret-bearing storage and keep it writable for guest `/connect`. V2 uses host-managed selected connections rather than that V1 store.

Guest `localhost` is not the host. To reach a trusted host Ollama daemon, use an explicit host route:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["opencode-ext-connector@0.8.0", {
      "providers": ["claude", "command-code", "ollama"],
      "ollamaBaseURL": "http://host.docker.internal:11434"
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
| Claude or Command Code has no models | Check the provider allow-list and dedicated API key; old OAuth/CLI markers are not accepted; restart after connection changes |
| V2 connection unavailable despite a process env key | Check the selected host connection and its resolved value; there is no fallback to a different env connection or V1 store |
| Old credential options rejected | Remove all retired fields listed in [Configuration](#configuration), even if disabled |
| Cursor or xAI projection unavailable | Cursor is excluded; use another supported provider. For xAI, use native OpenCode API-key authentication |
| Retained V1 model stops working | Obtain a model from the current host binding after a key, generation, membership, or disposal change |
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

Tests use deterministic fakes and loopback endpoints, including real isolated OpenCode processes under temporary HOME/XDG directories. They must not inherit host credentials or call live vendor endpoints. Official API generation helpers are exercised offline across the supported routes; this is not proof of live access to every vendor or plan.

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
