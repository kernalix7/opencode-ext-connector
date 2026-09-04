# CURSOR PROVIDER

Private Node HTTP/2 bridge plus the direct AgentService Run runtime. This is an
unpublished protocol integration, not a public Cursor API.

## WHERE TO LOOK

| Concern | Location | Contract |
|---------|----------|----------|
| Language entry | `language-model.ts`, `language-generate.ts` | LanguageModelV3 surface and runtime lease |
| Runtime ownership | `direct-runtime.ts` | Bridge lifecycle, new runs, and tool-result continuation |
| Logical run | `direct-run.ts` | Stores, physical attempts, retry loop, cleanup |
| Stream attempt | `direct-stream.ts`, `stream-adapter.ts` | One V3 stream across physical attempts |
| Recovery | `recovery.ts` | Checkpoint/history planner and idle watchdog |
| Parked calls | `run-session.ts`, `run-session-expiry.ts` | Ownership, continuation writes, TTL, disposal |
| Server events | `server-dispatch.ts`, `interaction-reply.ts` | Tool calls, checkpoints, usage, terminal events |
| Bridge parent | `bridge-client.ts`, `bridge-process.ts` | Bun-side multiplexing of the private child |
| Bridge child | `h2-bridge.ts`, `h2-bridge-session.ts`, `http2.ts` | Node 22 HTTP/2 process over private stdio |
| Bridge wire | `bridge-protocol.ts`, `bridge-serialize.ts`, `bridge-event-sanitize.ts` | NDJSON commands/events and token redaction |
| Protocol codecs | `proto/`, `proto-wire.ts`, `proto-value.ts` | Pinned protobuf fields and drift rejection |
| Tests | `tests/unit/providers/cursor/`, `tests/integration/cursor-*` | Codec, bridge, retry, continuation, isolation |

## CONVENTIONS

- The Bun parent spawns one plugin-owned Node child. Communication is private stdio; no
  user-facing port or plugin daemon is opened.
- `direct-run.ts` separates one logical run from its physical attempts. The stream adapter
  exposes one V3 stream while attempts may change underneath it.
- Recovery is replay-safe: retry only for retryable failures, never across a tool boundary,
  and never replay emitted output unless a matching checkpoint covers it.
- Tool results resolve exactly one parked session for the same model and are written to the
  original bidi Run. Reserved/consumed call IDs reject duplicates and mismatches.
- Session expiry, idle detection, retries, and stores use injected `Clock` scheduling.
- Cleanup must settle bridge streams, blob ownership, checkpoints, session state, and child
  process resources; preserve aggregate cleanup errors.
- Treat unknown or malformed protocol fields as drift. Update pinned codecs and static
  fixtures together; do not guess a compatible shape.
- Retain SPDX/source notices on bridge/protocol code derived from `pi-cursor`.

## ANTI-PATTERNS

- Reintroducing `cursor-agent`, its process pool, or resume-based child generation.
- Opening a listening daemon or passing credentials in child argv/environment.
- Replaying parked calls, attaching a tool result to an ambiguous session, or retrying across
  an unsafe output/tool boundary.
- Adding an implicit fallback after protocol drift; fail Cursor in isolation.
