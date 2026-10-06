# OLLAMA PROVIDER

Trusted daemon catalog/generation plus anonymous global Ollama Cloud JSON discovery,
independent of models installed on that daemon.
The daemon remains the only generation endpoint.

## WHERE TO LOOK

| Concern | Location | Contract |
|---------|----------|----------|
| Provider export surface | `index.ts` | Adapter, catalog state, runtime, and language model |
| Daemon endpoints | `endpoints.ts` | Strict normalized trusted base plus `/api/*` routes |
| Local catalog | `local-catalog.ts` | Configured daemon `/api/tags` parsing |
| Cloud catalog | `cloud-catalog.ts` | Public `https://ollama.com/api/tags`; every hosted ID must resolve before refresh completes |
| Cloud references | `cloud-reference.ts` | Bounded candidate probes against official registry manifests/config; exact hosted ID, approved HTTPS host, config size/digest, empty layers |
| Catalog lifetime | `catalog-state.ts` | Leases retain complete discovery and authorize pulls |
| Snapshot merge | `adapter.ts` | Local models win duplicate IDs; retain stale complete data |
| Local runtime | `runtime.ts` | Authorized `/api/pull`, then `/api/chat` |
| V3 model | `language-model.ts`, `generate.ts`, `stream.ts` | Prompt mapping and NDJSON output |
| Protocol boundary | `protocol.ts`, `ndjson.ts`, `errors.ts` | Strict response schemas and typed failures |
| Fetch boundary | `http.ts` | Destination-agnostic fetch and credential omission |
| Tests | `tests/unit/providers/ollama/`, `tests/integration/ollama-loopback.test.ts` | Catalog, pull, stream, and loopback |

## CONVENTIONS

- Daemon requests use one parsed immutable endpoint set. The default base is
  `http://localhost:11434`; explicit remote/self-hosted bases preserve path prefixes.
- Accept only literal absolute HTTP(S) bases. Reject credentials, queries, fragments,
  direct `/api/*` bases, and `ollama.com` or its subdomains before network I/O.
- Keep production fetch destination-agnostic; endpoint parsing owns destination policy.
  Requests omit credentials and reject redirects.
- Cloud discovery is catalog-only and anonymous. Read the global hosted JSON list from
  `https://ollama.com/api/tags`, not the configured daemon's installed-model list.
- Verify candidate daemon references using official `registry.ollama.ai` manifests/config:
  exact `remote_model` hosted-ID correspondence, approved `remote_host: https://ollama.com`,
  matching config byte size and SHA-256 digest, and zero weight layers (empty layer list).
  Bounded candidate names are probes, not pull authorization or an approved universal suffix
  contract. Comprehensive mapping and permission for probing remain unresolved review items.
- A catalog lease owns the last complete Cloud list and its authorized pull IDs. Releasing the
  final lease clears both.
- Merge local models before Cloud models so an exact local ID wins. On an incomplete refresh,
  retain the last complete merged catalog and report stale/unavailable accurately.
- Cloud refresh requires every hosted ID to resolve; unresolved mappings or verification
  failures retain the last complete Cloud list and authorizations, never a partial replacement.
  Without an initial complete refresh, no Cloud pull IDs are authorized.
- Discovery owns a child cancellation scope. A worker failure cancels and joins siblings
  before returning the original failure; it never aborts the caller's parent signal.
- Pull only an absent model authorized by an active catalog lease. Concurrent pulls for the
  same ID share one flight; remove settled/failed flights so later calls may retry.
- Selecting an absent verified, authorized reference automatically pulls its lightweight
  reference on the configured daemon before chat. `cloudPullAuthorization` retains original
  hosted-ID provenance; the shared pull flight uses `verifyCloudReference` to reverify the
  exact selected alias's manifest/config against that ID, without alternate-candidate
  substitution. After verification, `authorization.isCurrent()` rechecks active lease and
  unchanged reference membership before daemon pull; either failure prevents the pull.
  Refresh rechecks lease disposal and abort after discovery before publishing results.
  Each absent-model caller retains its original authorization and rechecks it after pull
  before chat. Already-installed local models do not require a Cloud lease.
  Generation and Cloud authentication stay daemon-side;
  `ollama signin` is separate on the daemon machine, with account plan/usage limits applicable.
- Keep NDJSON parsing, pull completion checks, and generation errors provider-local.

## ANTI-PATTERNS

- Reading an Ollama API key, honoring `OLLAMA_HOST`, or selecting an implicit generation host.
- Adding auth/custom headers, cookies, custom CA configuration, or TLS bypass.
- Calling the usage-billed direct Cloud API; generation always goes through the configured daemon.
- Sending connector credentials to Cloud discovery or localhost requests.
- Authorizing a pull from stale text, a caller-supplied ID, or catalog state without a lease.
- Replacing strict route/schema handling with permissive endpoint or payload fallback.
- Treating registry visibility or metadata validation as blanket service permission, complete
  hosted-ID mapping, live-generation validation, or release approval.
