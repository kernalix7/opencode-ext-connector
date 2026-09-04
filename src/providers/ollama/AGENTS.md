# OLLAMA PROVIDER

Local daemon catalog/generation plus anonymous discovery of official Ollama Cloud tags.
The daemon remains the only generation endpoint.

## WHERE TO LOOK

| Concern | Location | Contract |
|---------|----------|----------|
| Provider export surface | `index.ts` | Adapter, catalog state, runtime, and language model |
| Local catalog | `local-catalog.ts` | Fixed localhost `/api/tags` parsing |
| Cloud catalog | `cloud-catalog.ts`, `html-links.ts` | Official search/library HTML only |
| Catalog lifetime | `catalog-state.ts` | Leases retain complete discovery and authorize pulls |
| Snapshot merge | `adapter.ts` | Local models win duplicate IDs; retain stale complete data |
| Local runtime | `runtime.ts` | Authorized `/api/pull`, then `/api/chat` |
| V3 model | `language-model.ts`, `generate.ts`, `stream.ts` | Prompt mapping and NDJSON output |
| Protocol boundary | `protocol.ts`, `ndjson.ts`, `errors.ts` | Strict response schemas and typed failures |
| Fetch boundary | `http.ts` | Fixed endpoint policy and credential omission |
| Tests | `tests/unit/providers/ollama/`, `tests/integration/ollama-loopback.test.ts` | Catalog, pull, stream, and loopback |

## CONVENTIONS

- Local daemon requests use `http://localhost:11434` and fixed `/api/tags`, `/api/pull`, and
  `/api/chat` routes with credentials omitted and redirects rejected.
- Cloud discovery is catalog-only and anonymous. Parse exact Cloud tags from official Ollama
  search/library pages; do not derive arbitrary remote model IDs.
- A catalog lease owns the last complete Cloud list and its authorized pull IDs. Releasing the
  final lease clears both.
- Merge local models before Cloud models so an exact local ID wins. On an incomplete refresh,
  retain the last complete merged catalog and report stale/unavailable accurately.
- Pull only an absent model authorized by an active catalog lease. Concurrent pulls for the
  same ID share one flight; remove settled/failed flights so later calls may retry.
- Keep NDJSON parsing, pull completion checks, and generation errors provider-local.

## ANTI-PATTERNS

- Reading an Ollama API key, honoring `OLLAMA_HOST`, or selecting a remote generation host.
- Calling the usage-billed direct Cloud API; generation always goes through the local daemon.
- Sending connector credentials to Cloud discovery or localhost requests.
- Authorizing a pull from stale text, a caller-supplied ID, or catalog state without a lease.
- Replacing strict route/schema handling with permissive endpoint or payload fallback.
