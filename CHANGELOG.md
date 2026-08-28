# Changelog

## Unreleased

- Added Ollama as a fourth provider using the local daemon and existing
  `ollama signin` Cloud subscription session
- Added automatic Cloud-only online catalog refresh, pulled-local model
  discovery, local-first deduplication, and pull-on-first-use for Cloud tags
- Added `ollamaAuthServer` and the `opencode-ext-connector/ollama` SDK export
- Documented the direct `dist/index.js` plugin URL required for all named auth
  hooks under OpenCode 1.18.24
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
