# OpenCode External Provider Connector

[한국어](docs/README.ko.md)

An independent OpenCode plugin that exposes **Claude**, **Cursor**, and
**Command Code** from already-logged-in vendor CLIs. One `opencode.json`
plugin entry. No new OAuth.

## Disclaimer

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

## Requirements

- [Bun](https://bun.sh) 1.3.14 or later
- OpenCode with plugin v2/promise (`@opencode-ai/plugin@1.18.18`)
- Logged-in vendor CLIs you already use:
  - Claude Code credentials (`~/.claude/.credentials.json` and/or macOS Keychain)
  - `cursor-agent` on `PATH`
  - Command Code API key (`COMMAND_CODE_API_KEY` or `~/.commandcode/auth.json`)

## Install

Build this repo, then point OpenCode at the plugin:

```bash
bun install
bun run build
```

In `opencode.json` / `opencode.jsonc` (official `plugin` field):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:///absolute/path/to/00G_opencode-ext-connector"
  ]
}
```

Absolute paths and `file://` URLs are supported.

Provider ids: `claude`, `cursor`, `command-code`. Model ids come from live
catalogs (`/v1/models`, `cursor-agent models`, Command Code `/provider/v1/models`).

## Options

OpenCode passes plugin options as the second item of a two-element tuple.

| Option | Default | Meaning |
|---|---|---|
| `writeBackCredentials` | `false` | After Claude OAuth refresh, write tokens to Claude files, Keychain (macOS), and OpenCode `auth.json` |
| `catalogReloadMs` | `300000` | Re-run catalog snapshots on this interval; `0` disables |
| `snapshotTimeoutMs` | `30000` | Per-provider snapshot deadline |
| `health.initialBackoffMs` | `1000` | Health backoff after a failed snapshot |
| `health.maximumBackoffMs` | `60000` | Health backoff cap |

Writeback is off by default so this plugin does not mutate credential stores
unless asked. Enable it explicitly:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "file:///absolute/path/to/00G_opencode-ext-connector",
      { "writeBackCredentials": true }
    ]
  ]
}
```

With writeback off, refreshed Claude tokens stay in memory only. A stored
refresh token that rotates can then stop working on the next process start —
set `writeBackCredentials: true` if you want the files updated too.

## What it does

- Reuses existing CLI logins. Does not mint new OAuth.
- Disguises Claude HTTP as the official CLI. Streams Anthropic SSE.
- Runs `cursor-agent --print --output-format stream-json` with a process pool,
  tool-call stream parts, and `--resume`.
- Calls Command Code `/alpha/generate` with CLI fingerprint headers; streams
  NDJSON text and tool events.
- Isolates health: one provider failing does not remove the others.

## Development

```bash
bun run check
bun test
bun run verify:package
```

## Notices

Derived upstream work is listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

BSD-3-Clause. See [LICENSE](LICENSE).
