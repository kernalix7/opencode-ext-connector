import { describe, expect, it } from "bun:test"
import {
  decodeExecClientMessage,
  decodeExecServerMessage,
  encodeExecClientMessage,
  encodeExecServerMessage,
} from "../../../../../src/providers/cursor/proto/exec"
import type { ExecServerControl } from "../../../../../src/providers/cursor/proto/exec-control"
import {
  decodeInteractionUpdate,
  encodeInteractionUpdate,
  type InteractionUpdate,
} from "../../../../../src/providers/cursor/proto/interaction"
import {
  decodeInteractionQuery,
  decodeInteractionResponse,
  encodeInteractionQuery,
  encodeInteractionResponse,
} from "../../../../../src/providers/cursor/proto/interaction-query"
import {
  decodeKvServerMessage,
  encodeKvServerMessage,
} from "../../../../../src/providers/cursor/proto/kv"
import {
  decodeMcpResult,
  encodeMcpResult,
} from "../../../../../src/providers/cursor/proto/mcp-result"
import {
  decodeOutputLocation,
  encodeOutputLocation,
} from "../../../../../src/providers/cursor/proto/output-location"
import {
  decodeAgentServerMessage,
  encodeAgentServerMessage,
} from "../../../../../src/providers/cursor/proto/server"
import {
  concatBytes,
  encodeBytesField,
  encodeStringField,
} from "../../../../../src/providers/cursor/proto-wire"
import {
  AGENT_SERVER_CONTROL_FIXTURE,
  EXEC_CLIENT_NATIVE_FIXTURE,
  EXEC_MCP_RESULT_WITH_LOCATION_FIXTURE,
  EXEC_MCP_TOOL_NOT_FOUND_FIXTURE,
  EXEC_SERVER_NATIVE_WITH_SPAN_FIXTURE,
  INTERACTION_MCP_RESULT_WITH_LOCATION_FIXTURE,
  INTERACTION_MCP_UNKNOWN_RESULT_FIXTURE,
  INTERACTION_QUERY_FIELD_9_FIXTURE,
  INTERACTION_RESPONSE_FIELD_9_FIXTURE,
  INTERACTION_UPDATE_FIXTURES,
  KV_SERVER_WITH_SPAN_FIXTURE,
  SERVER_UNKNOWN_ACTIVE_ONEOF_FIXTURE,
  SERVER_WITH_UNKNOWN_FIELD_FIXTURE,
} from "./static-fixtures"

function int64Varint(value: bigint): Uint8Array {
  const modulus = 1n << 64n
  let remaining = value < 0n ? value + modulus : value
  const bytes: number[] = []
  do {
    const byte = Number(remaining & 0x7fn)
    remaining >>= 7n
    bytes.push(remaining === 0n ? byte : byte | 0x80)
  } while (remaining !== 0n)
  return Uint8Array.from(bytes)
}

describe("Cursor v1.4.26 Oracle audit fixtures", () => {
  it("round-trips the pinned exec-server-control field 5 abort", () => {
    // Given
    const expectedControl: ExecServerControl = { kind: "abort", id: 8 }

    // When
    const message = decodeAgentServerMessage(AGENT_SERVER_CONTROL_FIXTURE)

    // Then
    expect(message.kind).toBe("exec-server-control")
    if (message.kind === "exec-server-control") {
      expect(message.control).toEqual(expectedControl)
    }
    expect(encodeAgentServerMessage(message)).toEqual(AGENT_SERVER_CONTROL_FIXTURE)
  })

  it("models every pinned InteractionUpdate field 1 through 17", () => {
    // Given
    const expectedKinds: readonly InteractionUpdate["kind"][] = [
      "text-delta",
      "tool-call-started",
      "tool-call-completed",
      "thinking-delta",
      "thinking-completed",
      "user-message-appended",
      "partial-tool-call",
      "token-delta",
      "summary",
      "summary-started",
      "summary-completed",
      "shell-output-delta",
      "heartbeat",
      "turn-ended",
      "tool-call-delta",
      "step-started",
      "step-completed",
    ]

    // When
    const updates = INTERACTION_UPDATE_FIXTURES.map(decodeInteractionUpdate)

    // Then
    expect(updates.map((update) => update.kind)).toEqual([...expectedKinds])
    expect(updates.map(encodeInteractionUpdate)).toEqual([...INTERACTION_UPDATE_FIXTURES])
  })

  it("round-trips the live opaque InteractionQuery and Response field 9", () => {
    // Given
    const expectedKind = "field-9"

    // When
    const query = decodeInteractionQuery(INTERACTION_QUERY_FIELD_9_FIXTURE)
    const response = decodeInteractionResponse(INTERACTION_RESPONSE_FIELD_9_FIXTURE)

    // Then
    expect(query.kind).toBe(expectedKind)
    expect(response.kind).toBe(expectedKind)
    expect(encodeInteractionQuery(query)).toEqual(INTERACTION_QUERY_FIELD_9_FIXTURE)
    expect(encodeInteractionResponse(response)).toEqual(INTERACTION_RESPONSE_FIELD_9_FIXTURE)
  })

  it("preserves native exec variants and exec/KV span contexts", () => {
    // Given
    const expectedOperation = "shell"

    // When
    const serverExec = decodeExecServerMessage(EXEC_SERVER_NATIVE_WITH_SPAN_FIXTURE)
    const clientExec = decodeExecClientMessage(EXEC_CLIENT_NATIVE_FIXTURE)
    const kv = decodeKvServerMessage(KV_SERVER_WITH_SPAN_FIXTURE)

    // Then
    expect(serverExec.kind).toBe("native")
    expect(clientExec.kind).toBe("native")
    if (serverExec.kind === "native") {
      expect(serverExec.operation).toBe(expectedOperation)
      expect(serverExec.spanContext).toBeDefined()
    }
    expect(kv.spanContext).toBeDefined()
    expect(encodeExecServerMessage(serverExec)).toEqual(EXEC_SERVER_NATIVE_WITH_SPAN_FIXTURE)
    expect(encodeExecClientMessage(clientExec)).toEqual(EXEC_CLIENT_NATIVE_FIXTURE)
    expect(encodeKvServerMessage(kv)).toEqual(KV_SERVER_WITH_SPAN_FIXTURE)
  })

  it("keeps exec McpResult separate from interaction McpToolResult", () => {
    // Given
    const expectedLocation = {
      filePath: "/tmp/result.txt",
      sizeBytes: 0x20000000000001n,
      lineCount: 42n,
    }

    // When
    const execResult = decodeMcpResult(EXEC_MCP_RESULT_WITH_LOCATION_FIXTURE)
    const interaction = decodeInteractionUpdate(INTERACTION_MCP_RESULT_WITH_LOCATION_FIXTURE)
    const interactionUnknown = decodeInteractionUpdate(INTERACTION_MCP_UNKNOWN_RESULT_FIXTURE)
    const notFound = decodeMcpResult(EXEC_MCP_TOOL_NOT_FOUND_FIXTURE)
    const execContent = execResult.kind === "success" ? execResult.content.at(0) : undefined
    const interactionContent =
      interaction.kind === "tool-call-completed" && interaction.result?.kind === "success"
        ? interaction.result.content.at(0)
        : undefined

    // Then
    expect(execResult.kind).toBe("success")
    if (execContent?.kind === "text") {
      expect(execContent.outputLocation).toEqual(expectedLocation)
    }
    expect(interaction.kind).toBe("tool-call-completed")
    if (interactionContent?.kind === "text") {
      expect(interactionContent.outputLocation).toEqual(expectedLocation)
    }
    if (interactionUnknown.kind === "tool-call-completed") {
      expect(interactionUnknown.result).toMatchObject({ kind: "unknown-oneof", field: 5 })
    }
    expect(notFound.kind).toBe("tool-not-found")
    expect(encodeMcpResult(execResult)).toEqual(EXEC_MCP_RESULT_WITH_LOCATION_FIXTURE)
    expect(encodeInteractionUpdate(interaction)).toEqual(
      INTERACTION_MCP_RESULT_WITH_LOCATION_FIXTURE,
    )
  })

  it("preserves harmless unknown fields as non-stranding drift metadata", () => {
    // Given
    const expectedUnknownField = 99

    // When
    const message = decodeAgentServerMessage(SERVER_WITH_UNKNOWN_FIELD_FIXTURE)

    // Then
    expect(message.kind).toBe("interaction-update")
    expect(message.drift?.unknownFields.map((field) => field.field)).toEqual([expectedUnknownField])
    expect(message.drift?.stranding).toBe(false)
    expect(encodeAgentServerMessage(message)).toEqual(SERVER_WITH_UNKNOWN_FIELD_FIXTURE)
  })

  it("returns an opaque stranding variant for an unknown active oneof", () => {
    // Given
    const expectedField = 42

    // When
    const message = decodeAgentServerMessage(SERVER_UNKNOWN_ACTIVE_ONEOF_FIXTURE)

    // Then
    expect(message).toMatchObject({
      kind: "unknown-oneof",
      field: expectedField,
      drift: { stranding: true },
    })
    expect(encodeAgentServerMessage(message)).toEqual(SERVER_UNKNOWN_ACTIVE_ONEOF_FIXTURE)
  })

  it("preserves nested TextDeltaUpdate unknown fields as non-stranding drift", () => {
    // Given
    const fixture = encodeBytesField(
      1,
      concatBytes([encodeStringField(1, "delta"), encodeBytesField(99, Uint8Array.of(0xaa))]),
    )

    // When
    const update = decodeInteractionUpdate(fixture)
    const drift = Reflect.get(update, "drift")

    // Then
    expect(drift?.unknownFields.map((field: { readonly field: number }) => field.field)).toEqual([
      99,
    ])
    expect(drift?.stranding).toBe(false)
    expect(encodeInteractionUpdate(update)).toEqual(fixture)
  })

  it("round-trips signed int64 OutputLocation fields without precision loss", () => {
    // Given
    const positive = 0x20000000000001n
    const fixture = concatBytes([
      encodeStringField(1, "/tmp/result.txt"),
      Uint8Array.from([0x10, ...int64Varint(-1n)]),
      Uint8Array.from([0x18, ...int64Varint(positive)]),
    ])

    // When
    const location = decodeOutputLocation(fixture)
    const defaults = decodeOutputLocation(new Uint8Array())

    // Then
    expect(location).toEqual({ filePath: "/tmp/result.txt", sizeBytes: -1n, lineCount: positive })
    expect(encodeOutputLocation(location)).toEqual(fixture)
    expect(defaults).toEqual({ filePath: "", sizeBytes: 0n, lineCount: 0n })
    expect(encodeOutputLocation(defaults)).toEqual(new Uint8Array())
  })
})
