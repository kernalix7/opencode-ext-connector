<div align="center">

# OpenCode External Provider Connector

**One OpenCode plugin configuration for Claude, Cursor, Command Code, and Ollama — using existing vendor sessions and the local Ollama daemon. No new OAuth.**

<p>
  <img src="https://img.shields.io/badge/Bun-%3E%3D1.3.14-000000?style=for-the-badge" alt="Bun >=1.3.14" />
  <img src="https://img.shields.io/badge/TypeScript-6.0.2-3178C6?style=for-the-badge" alt="TypeScript 6.0.2" />
  <img src="https://img.shields.io/badge/OpenCode-E2E_tested-111111?style=for-the-badge" alt="OpenCode E2E tested" />
  <img src="https://img.shields.io/badge/License-BSD--3--Clause-blue?style=for-the-badge" alt="BSD-3-Clause" />
</p>

**English** · [한국어](docs/README.ko.md) · [Documentation](#documentation)

[Status](#status) · [Requirements](#requirements) · [Quick Install](#quick-install) · [Configuration](#configuration) · [First-Time Connection](#first-time-connection) · [Providers](#providers) · [Troubleshooting](#troubleshooting) · [Documentation](#documentation) · [Testing](#testing) · [License and Disclaimer](#license-and-disclaimer)

</div>

## Status

> Independent unofficial community plugin, version **0.3.1**. Package E2E tests exercise the legacy multi-function loader with the OpenCode CLI installed in CI. `@opencode-ai/plugin@1.18.18` is the compile-time plugin API target, not a runtime pin. Source is BSD-3-Clause. This project is not affiliated with, endorsed by, sponsored by, or authorized by OpenCode or any provider. Full terms are in [License and Disclaimer](#license-and-disclaimer).

Reuse the Claude, Cursor, Command Code, and Ollama sessions you already have. One `opencode.json` plugin entry publishes live catalogs into OpenCode. Claude and Cursor stay disconnected until OpenCode has a marker or OAuth record and the vendor session is present. Command Code may use an OpenCode-stored direct API key or an existing CLI session/key. Ollama requires the exact session marker plus a responsive localhost daemon.

## Requirements

| Need | Detail |
| --- | --- |
| [Bun](https://bun.sh) | 1.3.14 or later |
| Node.js | 22 or later, for Cursor direct generation only |
| OpenCode | Runtime with the legacy multi-function plugin loader; package E2E tests the CLI installed in CI. `@opencode-ai/plugin@1.18.18` is the compile-time API target. |
| Claude | Existing Claude Code credentials (`~/.claude/.credentials.json` and/or macOS Keychain). The `claude` binary is optional. |
| Cursor | Existing Cursor CLI login (`~/.config/cursor/auth.json` or `CURSOR_ACCESS_TOKEN`) |
| Command Code | Existing API key (`COMMAND_CODE_API_KEY` or `~/.commandcode/auth.json`). The `command-code` binary is optional. |
| Ollama | Installed local daemon running on `localhost:11434`; trust that process; run `ollama signin` separately for Cloud |

No vendor CLI has to be installed where OpenCode runs. Claude and Command Code requests carry a client version: the connector takes `ANTHROPIC_CLI_VERSION` / `COMMAND_CODE_CLI_VERSION` when set, otherwise an installed `claude` / `command-code` binary, otherwise the latest version published on the npm registry (`@anthropic-ai/claude-code`, `command-code`). Nothing is pinned in the package.

## Quick Install

Build this repository, then point OpenCode at the compiled module:

```bash
bun install
bun run build
```

In `opencode.json` / `opencode.jsonc` (official `plugin` field):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:///absolute/path/to/opencode-ext-connector/dist/index.js"
  ]
}
```

Use that direct `dist/index.js` URL from a trusted, user-owned `file://` build. A package-directory URL does not load this connector's named legacy auth hooks.

The one package entry exposes the catalog plugin plus the Claude, Cursor, Command Code, and Ollama auth hooks. Provider ids: `claude`, `cursor`, `command-code`, `ollama`. Model ids come from each provider's live catalog, with documented fallbacks `default` (Cursor) and `Qwen/Qwen3.8-Max` (Command Code) when a live list is empty.

## Configuration

OpenCode passes plugin options as the second item of a two-element tuple.

Omitted `providers` enables all four. An explicit list is a strict allow-list. Explicit `[]` disables all.

| Option | Default | Meaning |
| --- | --- | --- |
| `providers` | all four | Provider ids to register: `claude`, `cursor`, `command-code`, `ollama`; explicit `[]` disables all |
| `writeBackCredentials` | `false` | After Claude OAuth refresh, write tokens to Claude files, Keychain (macOS), and OpenCode `auth.json` |
| `credentialRefresh.mode` | `"auto"` | `"auto"` refreshes Claude tokens before expiry; `"never"` sends only what the credential file contains and re-reads that file after a 401 |
| `credentialRefresh.leadMs` | `60000` | How long before expiry `"auto"` starts refreshing |
| `catalogReloadMs` | `300000` | Re-run catalog snapshots on this interval; `0` disables |
| `snapshotTimeoutMs` | `30000` | Per-provider snapshot deadline |
| `health.initialBackoffMs` | `1000` | Health backoff after a failed snapshot |
| `health.maximumBackoffMs` | `60000` | Health backoff cap |

Writeback is off by default so this plugin does not mutate credential stores unless asked. Enable it explicitly:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "file:///absolute/path/to/opencode-ext-connector/dist/index.js",
      {
        "writeBackCredentials": true
      }
    ]
  ]
}
```

Enabled providers remain disconnected until their provider-specific auth rule is met: Claude and Cursor need an OpenCode marker or OAuth record plus the vendor session; Command Code may use an OpenCode-stored direct API key or an existing CLI session/key; Ollama needs the exact session marker plus a responsive localhost daemon.

The connector always performs one initial catalog refresh. `snapshotTimeoutMs` applies to each provider snapshot, while `catalogReloadMs: 0` disables only periodic refresh. Periodic refreshes are fixed-delay and single-flight: the next delay begins after the current refresh settles. Health backoff suppresses repeated failures; transient failures retain the last-known catalog, while an explicit unavailable snapshot removes only connector-owned provider data.

OpenCode builds its active provider registry during instance setup. Periodic refresh updates the connector's retained catalog and health state, but new authentication or changed model membership becomes visible after normal OpenCode instance reconstruction. The connector never forces reconstruction or writes generated provider configuration. The `@opencode-ai/plugin@1.18.18` package is the plugin API this connector targets; it is not an OpenCode runtime pin.

With writeback off, refreshed Claude tokens stay in memory only. A stored refresh token that rotates can then stop working on the next process start — set `writeBackCredentials: true` if you want the files updated too.

### Sharing one Claude login across machines

Anthropic rotates the refresh token on every refresh and invalidates the previous one. Two copies of `~/.claude/.credentials.json` that both refresh will therefore break each other. Copying the file works only if exactly one machine refreshes and every other machine receives the result before its own copy expires:

- **Owner** (where you log in): `writeBackCredentials: true` and a lead time large enough to publish the file before the copies expire, for example `credentialRefresh: { mode: "auto", leadMs: 1800000 }`.
- **Every copy**: `credentialRefresh: { mode: "never" }`. That machine never contacts the OAuth endpoint; when a request returns 401 it re-reads the file and retries once with whatever the owner pushed.
- Push `~/.claude/.credentials.json` from the owner to each copy whenever it changes (a file watcher is enough). OpenCode's own `auth.json` only needs the `anthropic` record once; leave its other providers alone.

Machines that refresh on their own — including a Claude Code install that is used interactively — must not share the file. Log in separately there.

## First-Time Connection

1. **Fully restart OpenCode** after adding the plugin URL. Quit the process and start it again so the named legacy auth hooks load. A reload or periodic catalog refresh is not instance reconstruction.
2. **Confirm local prerequisites** for the providers you enabled. Claude and Cursor need their vendor sessions. Command Code needs either an API key you will store in OpenCode or an existing CLI session/key. Ollama needs a process you trust on `http://localhost:11434`; Cloud still requires a separate `ollama signin`.
3. **Run `/connect`** for each provider you want. Claude and Cursor record a marker or OAuth entry only after the vendor session is available. Command Code can store a direct API key in OpenCode or reuse an existing CLI session/key. Ollama stores the exact session marker only when the localhost daemon responds. Models publish only after that provider-specific rule is met.
4. **Verify the catalogs.** Confirm Claude, Cursor, and Command Code models appear in OpenCode. For Ollama, run `opencode models ollama` and confirm locally pulled models plus Cloud tags discovered unauthenticated, without connector-supplied credentials.

Ollama `/connect` probes the local daemon and stores the exact session marker. It does not run `ollama signin` or handle Ollama credentials.

## Providers

| Provider | What it does |
| --- | --- |
| **Claude** | Reuses existing Claude Code credentials. Does not mint OAuth. Compatibility fetch sends CLI-compatible request metadata and streams Anthropic SSE on the built-in `anthropic` path. `writeBackCredentials` defaults to `false` (in-memory refresh only); `true` writes refreshed tokens to Claude files, macOS Keychain, and OpenCode `auth.json`. |
| **Cursor** | Calls Cursor's unpublished client protocol (`api2.cursor.sh` `AgentService`, Connect+protobuf over HTTP/2) with the CLI access token. A plugin-owned Node child communicates over private stdio, keeps tool results on the same bidi Run, never replays parked calls, opens no user-facing daemon, and never spawns `cursor-agent` for generation. Unofficial; not a public Cursor API. After protocol drift there is no implicit fallback — that provider fails. Requires Node.js 22 or later. Live catalog ids are used when present; otherwise the documented fallback is `default`. |
| **Command Code** | Calls `/alpha/generate` with CLI-compatible request metadata and streams provider-local NDJSON text and tool events. The client version comes from `COMMAND_CODE_CLI_VERSION`, an installed `command-code` binary, or the npm registry. Request metadata includes Node.js version, platform, architecture, and the absolute working directory. Live catalog ids are used when present; otherwise the documented fallback is `Qwen/Qwen3.8-Max`. |
| **Ollama** | Uses only the local daemon at `http://localhost:11434` with fixed `/api/tags`, `/api/pull`, and `/api/chat`. Trust the process bound to that port. Publishes models already pulled locally, plus exact Cloud tags discovered unauthenticated from Ollama's official Cloud search and library pages, without connector-supplied credentials. Local entries win exact duplicates. Incomplete Cloud refreshes retain the last complete list. Selecting an absent authorized Cloud tag pulls its lightweight remote reference on first use; concurrent pulls of the same tag share one in-flight request, and a failed pull can be retried later. The local daemon may then proxy Cloud-tag prompts under the user's Ollama Cloud subscription. The connector never uses an Ollama API key, the usage-billed direct Cloud API, `OLLAMA_HOST`, or a remote Cloud generation endpoint. |

Provider health is isolated: one provider failing does not remove the others.

The standalone SDK entry is `opencode-ext-connector/ollama`. It can generate with models already present in the local daemon; connector-managed Cloud auto-pull requires an active Ollama catalog lease.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `/connect` methods missing | The plugin URL must be a trusted, user-owned `file:///absolute/path/to/opencode-ext-connector/dist/index.js`. A package-directory URL does not load named legacy auth hooks. Fully restart OpenCode after changing it. |
| Provider enabled but no models | Omitted `providers` enables all four; an explicit list is a strict allow-list. Claude and Cursor need a marker or OAuth record plus the vendor session; Command Code may use an OpenCode-stored API key or a CLI session/key; Ollama needs the exact marker plus a responsive localhost daemon. Fully restart after `/connect` so instance reconstruction picks up new membership. |
| Claude works until the next start | Default `writeBackCredentials: false` keeps refreshed tokens in memory. A rotated refresh token then fails on the next process start unless writeback is enabled. |
| Claude reports `invalid_grant` on a copied credential file | Another copy of the same login already refreshed and rotated the refresh token. Give one machine ownership of refresh and set `credentialRefresh: { mode: "never" }` on the others, or log in separately. |
| `Claude Code client version is unavailable` | No `ANTHROPIC_CLI_VERSION`, no `claude` binary, and `registry.npmjs.org` was unreachable. Set the variable or allow registry access. |
| Cursor generation fails | Node.js 22 or later is required. Generation uses the unpublished protocol through a private Node child, not `cursor-agent`. Protocol drift fails that provider; there is no implicit fallback. |
| Command Code generation fails | The client version could not be resolved: set `COMMAND_CODE_CLI_VERSION`, install `command-code`, or allow access to `registry.npmjs.org`. Request metadata includes Node.js version, platform, architecture, and the absolute working directory. |
| Ollama missing from `opencode models ollama` | Start a process you trust on `localhost:11434`, then `/connect` so the exact session marker can be stored. Cloud tags are unauthenticated catalog entries without connector-supplied credentials; the local daemon may proxy Cloud-tag prompts. `OLLAMA_HOST`, API keys, and direct Cloud generation are not used. |
| One provider is down | Failures are isolated. Transient snapshot failures keep the last-known catalog; an unavailable snapshot removes only that connector-owned provider. |

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
bun test
bun run test:provider
bun run test:integration
bun run test:e2e
bun run verify:package
```

The E2E suite runs real isolated `opencode serve` processes under temporary HOME/XDG directories. It must not inherit host credentials, proxy/token variables, or access external vendor endpoints.

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
