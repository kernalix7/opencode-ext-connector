# Changelog

## 0.1.0

- OpenCode plugin exposing Claude, Cursor, and Command Code from existing CLI logins
- Live model catalogs (Anthropic `/v1/models`, `cursor-agent models`, Command Code `/provider/v1/models`)
- Claude OAuth refresh with optional writeback to Claude files, macOS Keychain, and OpenCode `auth.json`
- Cursor process pool, tool-call stream parts, `--resume`, `--list-models` fallback
- Command Code `/alpha/generate` CLI fingerprint request and NDJSON tool/text stream
- Catalog reload interval and process-exit dispose
