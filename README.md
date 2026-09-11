<div align="center">

# OpenCode External Provider Connector

**One OpenCode plugin configuration for Claude, Cursor, Command Code, and Ollama — using existing vendor sessions and a trusted Ollama daemon. No new OAuth.**

<p>
  <img src="https://img.shields.io/badge/Bun-%3E%3D1.3.14-000000?style=for-the-badge" alt="Bun >=1.3.14" />
  <img src="https://img.shields.io/badge/TypeScript-6.0.2-3178C6?style=for-the-badge" alt="TypeScript 6.0.2" />
  <img src="https://img.shields.io/badge/OpenCode-E2E_tested-111111?style=for-the-badge" alt="OpenCode E2E tested" />
  <img src="https://img.shields.io/badge/License-BSD--3--Clause-blue?style=for-the-badge" alt="BSD-3-Clause" />
</p>

**English** · [한국어](docs/README.ko.md) · [Documentation](#documentation)

[Status](#status) · [Requirements](#requirements) · [Quick Install](#quick-install) · [Configuration](#configuration) · [Host/Guest Sandbox Setup](#hostguest-sandbox-setup) · [Update and Remove](#update-and-remove) · [First-Time Connection](#first-time-connection) · [Providers](#providers) · [Troubleshooting](#troubleshooting) · [Documentation](#documentation) · [Testing](#testing) · [License and Disclaimer](#license-and-disclaimer)

</div>

## Status

> Independent unofficial community plugin, version **0.4.0**. Package E2E tests exercise the legacy multi-function loader with the OpenCode CLI installed in CI. `@opencode-ai/plugin@1.18.18` is the compile-time plugin API target, not a runtime pin. Source is BSD-3-Clause. This project is not affiliated with, endorsed by, sponsored by, or authorized by OpenCode or any provider. Full terms are in [License and Disclaimer](#license-and-disclaimer).

Reuse the Claude, Cursor, Command Code, and Ollama sessions you already have. One `opencode.json` plugin entry publishes live catalogs into OpenCode. Claude and Cursor stay disconnected until OpenCode has a marker or OAuth record and the vendor session is present. Command Code may use an OpenCode-stored direct API key or an existing CLI session/key. Ollama requires the exact session marker plus a responsive trusted daemon.

## Requirements

| Need | Detail |
| --- | --- |
| [Bun](https://bun.sh) | 1.3.14 or later |
| Node.js | 22 or later, for Cursor direct generation only |
| OpenCode | Runtime with the legacy multi-function plugin loader; package E2E tests the CLI installed in CI. `@opencode-ai/plugin@1.18.18` is the compile-time API target. |
| Claude | Existing Claude Code credentials (`~/.claude/.credentials.json` and/or macOS Keychain). The `claude` binary is optional. |
| Cursor | Existing Cursor CLI login (`~/.config/cursor/auth.json` or `CURSOR_ACCESS_TOKEN`) |
| Command Code | Existing API key (`COMMAND_CODE_API_KEY` or `~/.commandcode/auth.json`). The `command-code` binary is optional. |
| Ollama | A trusted daemon; defaults to `http://localhost:11434`, with explicit remote/self-hosted URLs supported; run `ollama signin` separately for Cloud |

No vendor CLI has to be installed where OpenCode runs. Claude and Command Code requests carry a client version: the connector takes `ANTHROPIC_CLI_VERSION` / `COMMAND_CODE_CLI_VERSION` when set, otherwise an installed `claude` / `command-code` binary, otherwise the latest version published on the npm registry (`@anthropic-ai/claude-code`, `command-code`). Nothing is pinned in the package.

## Quick Install

Choose either the global `~/.config/opencode/opencode.json` or project-level `opencode.json`, then add the package to the official singular `plugin` field:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-ext-connector"
  ]
}
```

OpenCode installs configured npm plugins with Bun at startup and caches them. For a reproducible installation, use an exact published version instead:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-ext-connector@0.4.0"]
}
```

Fully quit and restart OpenCode after adding or changing the entry; a reload is not enough.

The one package entry exposes the catalog plugin plus the Claude, Cursor, Command Code, and Ollama auth hooks. Provider ids: `claude`, `cursor`, `command-code`, `ollama`. Model ids come from each provider's live catalog, with documented fallbacks `default` (Cursor) and `Qwen/Qwen3.8-Max` (Command Code) when a live list is empty.

## Configuration

OpenCode passes plugin options as the second item of a two-element tuple. Use the npm package name as the first item.

Omitted `providers` enables all four. An explicit list is a strict allow-list. Explicit `[]` disables all.

| Option | Default | Meaning |
| --- | --- | --- |
| `providers` | all four | Provider ids to register: `claude`, `cursor`, `command-code`, `ollama`; explicit `[]` disables all |
| `ollamaBaseURL` | `"http://localhost:11434"` | Absolute `http` or `https` base for the trusted Ollama daemon; path prefixes are preserved |
| `credentialManagement` | omitted | Preferred authority policy: `"connector"` authorizes refresh and writeback where an adapter supports both; `"external"` prohibits connector refresh and writeback |
| `writeBackCredentials` | `false` | **Deprecated:** accepted alone for one migration cycle; controls Claude writeback after refresh |
| `credentialRefresh.mode` | `"auto"` | **Deprecated:** accepted alone for one migration cycle; controls Claude `"auto"` or `"never"` refresh behavior |
| `credentialRefresh.leadMs` | `60000` | **Deprecated:** accepted alone for one migration cycle; custom lead times still require this legacy configuration |
| `catalogReloadMs` | `300000` | Re-run catalog snapshots on this interval; `0` disables |
| `snapshotTimeoutMs` | `30000` | Per-provider snapshot deadline |
| `health.initialBackoffMs` | `1000` | Health backoff after a failed snapshot |
| `health.maximumBackoffMs` | `60000` | Health backoff cap |

`credentialManagement: "connector"` authorizes the connector to refresh and write back credentials where a provider adapter supports both. Today only Claude has that capability, mapping to automatic refresh with a `60_000` ms lead and writeback enabled:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencode-ext-connector",
      {
        "credentialManagement": "connector"
      }
    ]
  ]
}
```

Use external authority when another process manages credentials:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencode-ext-connector",
      {
        "credentialManagement": "external"
      }
    ]
  ]
}
```

`credentialManagement: "external"` prohibits connector refresh and writeback. Today Claude maps to never-refresh/no-write and can re-read externally managed credentials after a 401. When all credential-policy options are omitted, Claude preserves the legacy defaults: automatic refresh with a `60_000` ms lead and no writeback. If only `credentialManagement` is omitted, supplied deprecated `credentialRefresh` or `writeBackCredentials` options still control behavior. Cursor direct generation and Command Code remain read-only under both modes: on an exact pre-output HTTP 401, they re-read a changed, non-null credential and retry once only. This safe reread is not refresh or writeback, so both modes allow it; Cursor legacy/compatibility generation remains one-shot. Ollama is unaffected. This option does not log in, mint OAuth, synchronize machines, or imply that credentials use file storage.

For one migration cycle, `writeBackCredentials` and `credentialRefresh.*` remain accepted when used without `credentialManagement`; custom `credentialRefresh.leadMs` values still require the legacy configuration. Mixing the new option with either legacy option is rejected with: `` `credentialManagement` cannot be combined with deprecated `credentialRefresh` or `writeBackCredentials` ``.

Enabled providers remain disconnected until their provider-specific auth rule is met: Claude and Cursor need an OpenCode marker or OAuth record plus the vendor session; Command Code may use an OpenCode-stored direct API key or an existing CLI session/key; Ollama needs the exact session marker plus a responsive configured daemon.

To use an explicitly selected remote or self-hosted daemon, set the same flat option on the package entry:

```jsonc
{
  "plugin": [["opencode-ext-connector", { "ollamaBaseURL": "https://ollama.example.test/team" }]]
}
```

The connector appends `/api/tags`, `/api/pull`, and `/api/chat` to that base. It rejects credentials, query strings, fragments, direct API-route bases, and `ollama.com` hosts. It never reads `OLLAMA_HOST`, sends cookies or authorization headers, follows redirects, configures custom CAs, or disables TLS verification. Ollama has no built-in daemon authentication, so use only a daemon and network path you trust; terminate HTTPS and enforce access policy outside this connector. Distinct normalized bases have isolated catalog leases and pull flights, while equivalent normalized bases share process-local state.

The connector always performs one initial catalog refresh. `snapshotTimeoutMs` applies to each provider snapshot, while `catalogReloadMs: 0` disables only periodic refresh. Periodic refreshes are fixed-delay and single-flight: the next delay begins after the current refresh settles. Health backoff suppresses repeated failures; transient failures retain the last-known catalog, while an explicit unavailable snapshot removes only connector-owned provider data.

OpenCode builds its active provider registry during instance setup. Periodic refresh updates the connector's retained catalog and health state, but new authentication or changed model membership becomes visible after normal OpenCode instance reconstruction. The connector never forces reconstruction or writes generated provider configuration. The `@opencode-ai/plugin@1.18.18` package is the plugin API this connector targets; it is not an OpenCode runtime pin.

With all credential-policy options omitted, refreshed Claude tokens stay in memory only. A stored refresh token that rotates can then stop working on the next process start — choose `credentialManagement: "connector"` if the connector should have authority to write updates too. If only `credentialManagement` is omitted, supplied deprecated options still control refresh and writeback.

### Sharing one Claude login across machines

Anthropic rotates the refresh token on every refresh and invalidates the previous one. Two copies of `~/.claude/.credentials.json` that both refresh will therefore break each other. Copying the file works only if exactly one machine refreshes and every other machine receives the result before its own copy expires:

- **Refresh authority** (where you log in): `credentialManagement: "connector"`. If you need a custom publication window, use the deprecated legacy options alone for this migration cycle, for example `writeBackCredentials: true` with `credentialRefresh: { mode: "auto", leadMs: 1800000 }`.
- **External-authority machines**: `credentialManagement: "external"`. They never contact the OAuth endpoint; when a request returns 401 they re-read externally managed credentials and retry once.
- Synchronize the externally managed credential material from the refresh-authority machine whenever it changes. The option itself does not synchronize machines or require file storage; if you copy `~/.claude/.credentials.json`, OpenCode's own `auth.json` only needs the `anthropic` record once and its other providers should remain untouched.

Machines that refresh on their own — including a Claude Code install that is used interactively — must not share the file. Log in separately there.

## Host/Guest Sandbox Setup

When OpenCode runs in a container, VM, or another sandbox, treat that runtime as the **guest** and the machine that owns the vendor logins and Ollama daemon as the **host**. The guest has its own `localhost`, home directory, environment, keychains, filesystem permissions, and network namespace. Host sessions are not visible unless you mount their files or inject their environment values explicitly.

The safest shared-session layout keeps each vendor login owned and refreshed by the host, mounts only the required vendor credential source read-only, and gives the guest a separate writable persistent OpenCode data directory:

| Provider | Host | Guest |
| --- | --- | --- |
| Claude | Own and refresh the Claude Code login | Mount the Claude credential directory read-only, set `CLAUDE_CONFIG_DIR` to that guest path, and use `credentialManagement: "external"`; a host macOS Keychain is not available inside a Linux guest; resolve the client version with `ANTHROPIC_CLI_VERSION`, an installed `claude` binary, or npm registry access |
| Cursor | Own the Cursor CLI login | Mount the credential file at the guest's `${HOME}/.config/cursor/auth.json` read-only, or inject `CURSOR_ACCESS_TOKEN` through the sandbox's secret mechanism; install Node.js 22 or later in the guest |
| Command Code | Own the CLI login or API key | Mount `${HOME}/.commandcode/auth.json` read-only, or inject `COMMAND_CODE_API_KEY`; resolve the client version with `COMMAND_CODE_CLI_VERSION`, an installed `command-code` binary, or npm registry access |
| Ollama | Run the trusted daemon and run `ollama signin` there when Cloud access is needed | Copy no Ollama credential; connect only to the daemon selected by `ollamaBaseURL` |

For example, a Linux guest can use these paths and optional secret/version overrides; adapt the mount source and destination to the sandbox runtime:

```dotenv
HOME=/home/sandbox
XDG_DATA_HOME=/home/sandbox/.local/share
CLAUDE_CONFIG_DIR=/run/host-credentials/claude
CURSOR_ACCESS_TOKEN=<optional-sandbox-secret>
COMMAND_CODE_API_KEY=<optional-sandbox-secret>
ANTHROPIC_CLI_VERSION=<optional-compatible-version>
COMMAND_CODE_CLI_VERSION=<optional-compatible-version>
```

Set a writable persistent `XDG_DATA_HOME` for the guest. `/connect` writes OpenCode auth state to `${XDG_DATA_HOME}/opencode/auth.json`, or on Linux to `${HOME}/.local/share/opencode/auth.json` when `XDG_DATA_HOME` is unset. That file may contain a secret Claude OAuth record or Command Code API key; Cursor and Ollama use non-secret CLI-session markers, and Command Code can use either a marker or a key. Protect it as a secret-bearing file. Do not mount the entire host OpenCode data directory read-only when guest `/connect` or Claude writeback must update it.

Use this complete guest `opencode.json` when all four providers are enabled and the host owns the shared credentials:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencode-ext-connector",
      {
        "providers": ["claude", "cursor", "command-code", "ollama"],
        "ollamaBaseURL": "http://host.docker.internal:11434",
        "credentialManagement": "external",
        "catalogReloadMs": 300000,
        "snapshotTimeoutMs": 30000,
        "health": {
          "initialBackoffMs": 1000,
          "maximumBackoffMs": 60000
        }
      }
    ]
  ]
}
```

`ollamaBaseURL` is a flat connector option in the package tuple, not an OpenCode provider option. The numeric values above are the connector defaults; `credentialManagement: "external"` and the host daemon URL are deliberate overrides for read-only host-owned credentials. Do not put vendor tokens in `opencode.json`; pass them through read-only mounts or the sandbox's secret injection mechanism.

For Docker Desktop, `host.docker.internal` normally resolves to the host. A Linux Docker bridge may also need `--add-host=host.docker.internal:host-gateway` or the Compose equivalent:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

Ollama normally listens on host loopback. For bridge networking, the host may need to start it with `OLLAMA_HOST=0.0.0.0:11434`; restrict the exposed port with host firewall and sandbox network policy. `OLLAMA_HOST` configures the host daemon, while `ollamaBaseURL` configures this connector in the guest. Host networking makes guest `localhost` reach the host but reduces isolation and should be an explicit choice. Other sandbox runtimes need an equivalent host route and must allow outbound access to each enabled provider; allow `registry.npmjs.org` only when Claude or Command Code cannot resolve its client version from an environment value or installed binary.

Alternatively, the guest can own its vendor logins in persistent guest storage. In that mode, run vendor login flows in the guest instead of mounting host credentials. A guest that is the sole Claude refresh owner may use `credentialManagement: "connector"`. Never let the host and guest independently refresh credentials descended from the same Claude refresh token.

## Update and Remove

To update deterministically, check the desired published version, replace the `plugin` entry with that exact spec, then fully restart OpenCode:

```bash
npm view opencode-ext-connector version
```

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-ext-connector@<version>"]
}
```

Do not rely on an unpinned entry to refresh its cached package automatically on restart. To remove the connector, remove its entry from `plugin` and fully restart OpenCode. Cached package files are inert when the package is not configured.

## First-Time Connection

If OpenCode runs in a sandbox, complete [Host/Guest Sandbox Setup](#hostguest-sandbox-setup), including writable OpenCode auth storage and host networking, before `/connect`.

1. **Fully restart OpenCode** after adding the npm package entry or version spec. Quit the process and start it again so the named legacy auth hooks load. A reload or periodic catalog refresh is not instance reconstruction.
2. **Confirm local prerequisites** for the providers you enabled. Claude and Cursor need their vendor sessions. Command Code needs either an API key you will store in OpenCode or an existing CLI session/key. Ollama needs a daemon you trust at the configured `ollamaBaseURL`; Cloud still requires a separate `ollama signin`.
3. **Run `/connect`** for each provider you want. Claude and Cursor record a marker or OAuth entry only after the vendor session is available. Command Code can store a direct API key in OpenCode or reuse an existing CLI session/key. Ollama stores the exact session marker only when the configured daemon responds. Models publish only after that provider-specific rule is met.
4. **Verify the catalogs.** Confirm Claude, Cursor, and Command Code models appear in OpenCode. For Ollama, run `opencode models ollama` and confirm locally pulled models plus Cloud tags discovered unauthenticated, without connector-supplied credentials.

Ollama `/connect` probes the configured daemon and stores the exact session marker. It does not run `ollama signin` or handle Ollama credentials.

## Providers

| Provider | What it does |
| --- | --- |
| **Claude** | Reuses existing Claude Code credentials. Does not mint OAuth. Compatibility fetch sends CLI-compatible request metadata and streams Anthropic SSE on the built-in `anthropic` path. `credentialManagement: "connector"` maps to auto-refresh with a `60_000` ms lead and writeback; `"external"` maps to never-refresh/no-write with a credential re-read after 401. Omitting all credential-policy options preserves legacy auto/`60_000` behavior without writeback; if only `credentialManagement` is omitted, supplied deprecated options still control behavior. |
| **Cursor** | Calls Cursor's unpublished client protocol (`api2.cursor.sh` `AgentService`, Connect+protobuf over HTTP/2) with the CLI access token. Credentials remain read-only under both credential-management modes. Direct generation may re-read a changed, non-null credential and retry once only on an exact HTTP 401 before output or effects; this is not refresh or writeback. Legacy/compatibility generation remains one-shot. A plugin-owned Node child communicates over private stdio, keeps tool results on the same bidi Run, never replays parked calls, opens no user-facing daemon, and never spawns `cursor-agent` for generation. Unofficial; not a public Cursor API. After protocol drift there is no implicit fallback — that provider fails. Requires Node.js 22 or later. Live catalog ids are used when present; otherwise the documented fallback is `default`. |
| **Command Code** | Calls `/alpha/generate` with CLI-compatible request metadata and streams provider-local NDJSON text and tool events. Credentials remain read-only under both credential-management modes. On an exact HTTP 401 before output or effects, it may re-read a changed, non-null credential and retry once only; this is not refresh or writeback. The client version comes from `COMMAND_CODE_CLI_VERSION`, an installed `command-code` binary, or the npm registry. Request metadata includes Node.js version, platform, architecture, and the absolute working directory. Live catalog ids are used when present; otherwise the documented fallback is `Qwen/Qwen3.8-Max`. |
| **Ollama** | Unaffected by `credentialManagement`. Uses the trusted daemon selected by `ollamaBaseURL` (default `http://localhost:11434`) with `/api/tags`, `/api/pull`, and `/api/chat`; path prefixes are preserved. Publishes models already pulled there, plus exact Cloud tags discovered anonymously from Ollama's official Cloud search and library pages, without connector-supplied credentials. Local entries win exact duplicates. Incomplete Cloud refreshes retain the last complete list. Selecting an absent authorized Cloud tag pulls its lightweight remote reference on first use; concurrent pulls of the same tag and normalized base share one in-flight request, and a failed pull can be retried later. The daemon may then proxy Cloud-tag prompts under the user's Ollama Cloud subscription. The connector never uses an Ollama API key, the usage-billed direct Cloud API, `OLLAMA_HOST`, credentials, custom headers, cookies, or a direct Cloud generation endpoint. |

Provider health is isolated: one provider failing does not remove the others.

The standalone SDK entry is `opencode-ext-connector/ollama`; pass `{ ollamaBaseURL }` to select the same trusted daemon. It can generate with models already present there; connector-managed Cloud auto-pull requires an active Ollama catalog lease for that normalized base.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `/connect` methods missing | Confirm `plugin` contains `"opencode-ext-connector"` or an exact published `"opencode-ext-connector@<version>"` spec, then fully restart OpenCode. |
| Provider enabled but no models | Omitted `providers` enables all four; an explicit list is a strict allow-list. Claude and Cursor need a marker or OAuth record plus the vendor session; Command Code may use an OpenCode-stored API key or a CLI session/key; Ollama needs the exact marker plus a responsive configured daemon. Fully restart after `/connect` so instance reconstruction picks up new membership. |
| Claude works until the next start | Omitting all credential-policy options preserves legacy in-memory refresh without writeback. A rotated refresh token can then fail on the next process start; use `credentialManagement: "connector"` when the connector should refresh and write back. If only `credentialManagement` is omitted, check supplied deprecated refresh/writeback options instead. |
| Claude reports `invalid_grant` on shared credentials | Another machine with the same login already refreshed and rotated the refresh token. Give one machine refresh authority with `credentialManagement: "connector"` and use `"external"` on the others, or log in separately. |
| Configuration rejects credential options | Do not combine the new and legacy options; the exact error is: `` `credentialManagement` cannot be combined with deprecated `credentialRefresh` or `writeBackCredentials` ``. Legacy options remain accepted alone for one migration cycle. |
| `Claude Code client version is unavailable` | No `ANTHROPIC_CLI_VERSION`, no `claude` binary, and `registry.npmjs.org` was unreachable. Set the variable or allow registry access. |
| Cursor generation fails | Node.js 22 or later is required. Generation uses the unpublished protocol through a private Node child, not `cursor-agent`. Protocol drift fails that provider; there is no implicit fallback. |
| Command Code generation fails | The client version could not be resolved: set `COMMAND_CODE_CLI_VERSION`, install `command-code`, or allow access to `registry.npmjs.org`. Request metadata includes Node.js version, platform, architecture, and the absolute working directory. |
| Ollama missing from `opencode models ollama` | Start a daemon you trust at `ollamaBaseURL` (or the default `localhost:11434`), then `/connect` so the exact session marker can be stored. Confirm any path prefix reaches Ollama's `/api/*` routes. Cloud tags are anonymous catalog entries; `OLLAMA_HOST`, API keys, credential headers, redirects, and direct Cloud generation are not used. |
| Host credentials exist but the guest provider is disconnected | Check the mount target and permissions, the guest's `HOME`, `CLAUDE_CONFIG_DIR`, injected secret environment, writable guest OpenCode `auth.json`, and whether `/connect` completed inside the guest. |
| Ollama works on the host but not in the guest | Guest `localhost` is usually not the host. Check `host.docker.internal` resolution, Linux `host-gateway` mapping, the daemon bind address, firewall and sandbox egress, and whether any base path prefix reaches Ollama's `/api/*` routes. |
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
