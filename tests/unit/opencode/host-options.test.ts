import { describe, expect, it } from "bun:test"

import { ConnectorOptionsSchema, parseConnectorOptions } from "../../../src/core/options"
import { pickConnectorOptionsInput } from "../../../src/opencode/host-options"

describe("pickConnectorOptionsInput", () => {
  it("keeps known fields and drops host-only keys", () => {
    // Given
    const input = {
      providers: ["cursor"],
      snapshotTimeoutMs: 12_000,
      health: { initialBackoffMs: 2_000, maximumBackoffMs: 8_000 },
      id: "opencode-ext-connector",
      extra: true,
    }
    // When
    const options = parseConnectorOptions(pickConnectorOptionsInput(input))
    // Then
    expect(options).toEqual({
      providers: ["cursor"],
      snapshotTimeoutMs: 12_000,
      writeBackCredentials: false,
      credentialRefresh: { mode: "auto", leadMs: 60_000 },
      catalogReloadMs: 300_000,
      health: { initialBackoffMs: 2_000, maximumBackoffMs: 8_000 },
    })
  })

  it("keeps a valid credentialRefresh policy and drops malformed fields", () => {
    // Given / When
    const options = parseConnectorOptions(
      pickConnectorOptionsInput({
        credentialRefresh: { mode: "never", leadMs: "soon", unrelated: 1 },
      }),
    )
    // Then
    expect(options.credentialRefresh).toEqual({ mode: "never", leadMs: 60_000 })
  })

  it("ignores an unknown credentialRefresh mode", () => {
    // Given / When
    const options = parseConnectorOptions(
      pickConnectorOptionsInput({ credentialRefresh: { mode: "sometimes", leadMs: 5 } }),
    )
    // Then
    expect(options.credentialRefresh).toEqual({ mode: "auto", leadMs: 5 })
  })

  it("preserves connector credential management through host sanitization", () => {
    // Given
    const input = { credentialManagement: "connector", extra: true }
    // When
    const options = parseConnectorOptions(pickConnectorOptionsInput(input))
    // Then
    expect(options.credentialRefresh).toEqual({ mode: "auto", leadMs: 60_000 })
    expect(options.writeBackCredentials).toBe(true)
  })

  it("treats explicitly undefined legacy fields as absent", () => {
    // Given
    const input = {
      credentialManagement: "connector",
      credentialRefresh: undefined,
      writeBackCredentials: undefined,
    }
    // When
    const picked = pickConnectorOptionsInput(input)
    const options = parseConnectorOptions(picked)
    // Then
    expect("credentialRefresh" in picked).toBe(false)
    expect("writeBackCredentials" in picked).toBe(false)
    expect(options.credentialRefresh).toEqual({ mode: "auto", leadMs: 60_000 })
    expect(options.writeBackCredentials).toBe(true)
  })

  it("preserves external credential management through host sanitization", () => {
    // Given
    const input = { credentialManagement: "external", extra: true }
    // When
    const options = parseConnectorOptions(pickConnectorOptionsInput(input))
    // Then
    expect(options.credentialRefresh).toEqual({ mode: "never", leadMs: 60_000 })
    expect(options.writeBackCredentials).toBe(false)
  })

  it("keeps an empty legacy refresh object present for conflict validation", () => {
    // Given
    const input = { credentialManagement: "connector", credentialRefresh: {} }
    // When
    const result = ConnectorOptionsSchema.safeParse(pickConnectorOptionsInput(input))
    // Then
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues).toContainEqual({
      code: "custom",
      message:
        "`credentialManagement` cannot be combined with deprecated `credentialRefresh` or `writeBackCredentials`",
      path: ["credentialManagement"],
    })
  })

  it("keeps explicit legacy writeback false present for conflict validation", () => {
    // Given
    const input = { credentialManagement: "external", writeBackCredentials: false }
    // When
    const result = ConnectorOptionsSchema.safeParse(pickConnectorOptionsInput(input))
    // Then
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues).toContainEqual({
      code: "custom",
      message:
        "`credentialManagement` cannot be combined with deprecated `credentialRefresh` or `writeBackCredentials`",
      path: ["credentialManagement"],
    })
  })

  it.each([
    ["connector refresh null", "connector", "credentialRefresh", null, ["credentialRefresh"]],
    ["external refresh number", "external", "credentialRefresh", 1, ["credentialRefresh"]],
    [
      "connector malformed refresh object",
      "connector",
      "credentialRefresh",
      { mode: "sometimes" },
      ["credentialRefresh", "mode"],
    ],
    [
      "external writeback string",
      "external",
      "writeBackCredentials",
      "yes",
      ["writeBackCredentials"],
    ],
    [
      "connector writeback number",
      "connector",
      "writeBackCredentials",
      1,
      ["writeBackCredentials"],
    ],
  ] as const)(
    "preserves malformed policy input for strict validation: %s",
    (_case, credentialManagement, field, malformed, expectedPath) => {
      // Given
      const input = { credentialManagement, [field]: malformed }

      // When
      const picked = pickConnectorOptionsInput(input)
      const result = ConnectorOptionsSchema.safeParse(picked)

      // Then
      expect(picked[field]).toEqual(malformed)
      expect(result.success).toBe(false)
      if (result.success) return
      expect(
        result.error.issues.some((issue) => issue.path.join(".") === expectedPath.join(".")),
      ).toBe(true)
    },
  )

  it.each([
    ["refresh null", { credentialRefresh: null }, { mode: "auto", leadMs: 60_000 }, false],
    ["refresh number", { credentialRefresh: 1 }, { mode: "auto", leadMs: 60_000 }, false],
    [
      "malformed refresh field",
      { credentialRefresh: { mode: "never", leadMs: "soon" } },
      { mode: "never", leadMs: 60_000 },
      false,
    ],
    ["writeback string", { writeBackCredentials: "yes" }, { mode: "auto", leadMs: 60_000 }, false],
    ["writeback number", { writeBackCredentials: 1 }, { mode: "auto", leadMs: 60_000 }, false],
  ] as const)(
    "keeps legacy-alone sanitization compatible: %s",
    (_case, input, expectedRefresh, expectedWriteBack) => {
      // Given / When
      const options = parseConnectorOptions(pickConnectorOptionsInput(input))

      // Then
      expect(options.credentialRefresh).toEqual(expectedRefresh)
      expect(options.writeBackCredentials).toBe(expectedWriteBack)
    },
  )

  it("treats explicit undefined credential management as absent", () => {
    // Given
    const input = { credentialManagement: undefined }
    // When
    const options = parseConnectorOptions(pickConnectorOptionsInput(input))
    // Then
    expect(options.credentialRefresh).toEqual({ mode: "auto", leadMs: 60_000 })
    expect(options.writeBackCredentials).toBe(false)
  })

  it.each([
    ["unsupported string", "host"],
    ["null", null],
    ["number", 1],
    ["malformed mixture", ["connector", "external"]],
  ])("preserves %s credential management for strict validation", (_case, credentialManagement) => {
    // Given
    const input = { credentialManagement, extra: true }

    // When
    const picked = pickConnectorOptionsInput(input)
    const result = ConnectorOptionsSchema.safeParse(picked)

    // Then
    expect(picked.credentialManagement).toEqual(credentialManagement)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((issue) => issue.path[0] === "credentialManagement")).toBe(true)
  })

  it("defaults when the host passes an unrelated object", () => {
    // Given
    const input = { name: "opencode" }
    // When
    const options = parseConnectorOptions(pickConnectorOptionsInput(input))
    // Then
    expect(options.snapshotTimeoutMs).toBe(30_000)
    expect(options.health.initialBackoffMs).toBe(1_000)
    expect(options.writeBackCredentials).toBe(false)
  })

  it("honors writeBackCredentials true from the host", () => {
    // Given / When
    const options = parseConnectorOptions(pickConnectorOptionsInput({ writeBackCredentials: true }))
    // Then
    expect(options.writeBackCredentials).toBe(true)
  })
})
