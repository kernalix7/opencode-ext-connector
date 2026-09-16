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
| `options.ts` | `parseConnectorOptions` | `credentialRole` and `credentialManagement` are input-only and normalize to existing fields; owner means external + Claude CLI authority, reader means external without authority; roles conflict with every low-level credential option; owner requires Claude. CLI authority otherwise requires external management plus Claude; omission preserves defaults. Present `undefined` defaults (30_000 / 1_000 / 60_000); initial ≤ max |
| `logger.ts` | `createConnectorLogger` | Sink only; recursive key + URL query redaction |
| `http.ts` | `HttpTransport` | Interface; body is `Uint8Array` |
| `process.ts` | `ProcessSupervisor` / `SupervisedProcess` | Interface only; provider runtimes own process boundaries |

Tests: `tests/unit/core/<same>.test.ts`. Fakes: `tests/support/{clock,http,process,log-sink}.ts`.

## CONVENTIONS

- Zod objects `.strict()` + nested `.readonly()`.
- `HttpTransport` / `ProcessSupervisor` stay unimplemented here.
- Core defines the CLI authority options and process interfaces only; provider
  scheduling and production process I/O stay outside this layer.
- Keep `credentialRole` provider-agnostic at the input boundary: normalize it
  into existing policy and authority fields, and do not expose it in parsed
  output or branch on it inside providers.
- No barrel `index.ts` — import the file.

## ANTI-PATTERNS

- Hard-code provider IDs in this folder.
- Push-style adapters or mixing protocol parsers into `refreshProviderCatalog`.
