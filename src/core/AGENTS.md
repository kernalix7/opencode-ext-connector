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
| `options.ts` | `parseConnectorOptions` | Three-provider defaults and Cursor exclusion retained. Owner/reader and management normalize into refresh/writeback/authority fields; roles are input-only. Normalization performs no I/O. Independent strict `xaiOAuth.mode` authority/consumer is restored; it is not a provider-list member. |
| `credential-authority-options.ts` | Pure authority schema/types | Reused by ownership normalization; output is deeply frozen. Configuring authority does not start its scheduler. |
| `logger.ts` | `createConnectorLogger` | Sink only; recursive key + URL query redaction |
| `http.ts` | `HttpTransport` | Interface; body is `Uint8Array` |
| `process.ts` | `ProcessSupervisor` / `SupervisedProcess` | Interface only; provider runtimes own process boundaries |

Tests: `tests/unit/core/<same>.test.ts`. Fakes: `tests/support/{clock,http,process,log-sink}.ts`.

## CONVENTIONS

- Zod objects `.strict()` + nested `.readonly()`.
- `HttpTransport` / `ProcessSupervisor` stay unimplemented here.
- Process interfaces remain pure; production process I/O stays outside this layer.
- Ownership and management are input-only policies. Reader selects never-refresh/no-write
  without authority; owner additionally configures optional Claude authority. Roles conflict
  with explicit low-level policies, and owner requires Claude. Enabled low-level authority
  requires external management plus Claude. Keep normalization free of provider I/O.
- Omitted policy preserves auto/60_000/no-write; connector selects auto/60_000/write;
  external selects never/60_000/no-write. Legacy refresh/writeback fields remain accepted
  alone, but not alongside management. `xaiOAuth` omission/undefined normalizes
  to null (disabled); literal null, missing/unknown modes and extra fields reject.
  Both modes remain independent of the three-provider allow-list and Claude policy.
- The original xAI consumer contract is V1-only. V2 rejects normalized consumer
  mode with a typed setup error before allocation at the V2 composition boundary;
  core normalization remains pure and does not allocate an observer or transport.
  Authority remains available for selected-source observation. Omitted consumer
  opt-in does not alter independent native API-key use or other V2 providers.
- Timer inputs are integers capped at 2_147_483_647; snapshot/health are positive,
  catalog reload is non-negative. `ollamaBaseURL` stays at the host/SDK boundary.
- No barrel `index.ts` — import the file.

## ANTI-PATTERNS

- Hard-code provider IDs in generic primitives; the existing connector option allow-list
  belongs only in `options.ts` and does not constrain the ID brands.
- Push-style adapters or mixing protocol parsers into `refreshProviderCatalog`.
