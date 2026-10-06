# CORE CONTRACTS

Frozen T1 layer. Provider-agnostic. No I/O, no credentials, no `@opencode-ai/*`.

## OVERVIEW

Pull-based adapter + catalog snapshot primitives shared by provider implementations.

## WHERE TO LOOK

| File | Owns | Do not break |
|------|------|--------------|
| `ids.ts` | `ProviderId` / `ModelId` Zod brands | Reject, never normalize; no allowlist |
| `models.ts` | `ProviderSnapshot` `ready\|stale\|unavailable` | Duplicate model IDs in one snapshot fail; unavailable has no `models` |
| `adapter.ts` | `ProviderAdapter`, `CatalogPublisher`, `refreshProviderCatalog` | Mismatched `providerId` → `AdapterError`, not published |
| `errors.ts` | `ConnectorError` tree | Schema failures stay `ZodError`; do not wrap |
| `clock.ts` | `Clock`, `ScheduledCallback` | Only time source for core |
| `deadline.ts` | `createDeadline` | Parent abort + clock expiry; dispose cancels schedule |
| `lifecycle.ts` | `createAsyncDisposable` | Second `dispose()` returns the same promise |
| `health.ts` | `reduceHealth` | Pure reducer; backoff from `event.atMs`, not wall clock |
| `options.ts` | `parseConnectorOptions` | Defaults to Claude/Command Code/Ollama; `[]` disables all; Cursor rejects. Snapshot/catalog/health defaults: 30_000 / 300_000 / 1_000 / 60_000; present `undefined` uses defaults; initial ≤ max; frozen output |
| `credential-authority-options.ts` | Legacy pure schema/types | File remains unused by runtime; it does not enable CLI authority or make retired options valid |
| `logger.ts` | `createConnectorLogger` | Sink only; recursive key + URL query redaction |
| `http.ts` | `HttpTransport` | Interface; body is `Uint8Array` |
| `process.ts` | `ProcessSupervisor` / `SupervisedProcess` | Interface only; provider runtimes own process boundaries |

Tests: `tests/unit/core/<same>.test.ts`. Fakes: `tests/support/{clock,http,process,log-sink}.ts`.

## CONVENTIONS

- Zod objects `.strict()` + nested `.readonly()`.
- `HttpTransport` / `ProcessSupervisor` stay unimplemented here.
- Process interfaces remain pure; production process I/O stays outside this layer.
- `options.ts` explicitly rejects present `credentialRole`, `credentialManagement`,
  `credentialAuthority`, `credentialRefresh`, `writeBackCredentials`, and `xaiOAuth`,
  including disabled or `undefined` values. No credential-policy normalization remains.
- Timer inputs are integers capped at 2_147_483_647; snapshot/health are positive,
  catalog reload is non-negative. `ollamaBaseURL` stays at the host/SDK boundary.
- No barrel `index.ts` — import the file.

## ANTI-PATTERNS

- Hard-code provider IDs in generic primitives; the existing connector option allow-list
  belongs only in `options.ts` and does not constrain the ID brands.
- Push-style adapters or mixing protocol parsers into `refreshProviderCatalog`.
