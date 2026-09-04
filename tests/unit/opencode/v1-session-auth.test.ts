import { describe, expect, it } from "bun:test"

import {
  createCommandCodeSessionAuth,
  createCursorSessionAuth,
  createOllamaSessionAuth,
} from "../../../src/opencode/v1-session-auth"

describe("Custom provider session auth", () => {
  it("does not expose loaders for providers absent from OpenCode's catalog database", () => {
    // Given
    const hooks = [
      createCursorSessionAuth({}),
      createCommandCodeSessionAuth({}),
      createOllamaSessionAuth(),
    ]

    // When
    const loaders = hooks.map((hook) => hook.loader)

    // Then
    expect(loaders).toEqual([undefined, undefined, undefined])
  })
})

describe("Cursor session auth", () => {
  it("authorizes with the direct Cursor access token", async () => {
    // Given
    const auth = createCursorSessionAuth({ CURSOR_ACCESS_TOKEN: "cursor-token", PATH: "" })
    const method = auth.methods[0]
    if (method === undefined) {
      throw new Error("Cursor session method is missing")
    }

    // When
    if (method.authorize === undefined) {
      throw new Error("Cursor session authorize handler is missing")
    }
    const authorization = await method.authorize({})
    if (!("callback" in authorization)) {
      throw new Error("Cursor session authorization callback is missing")
    }
    const callback = await authorization.callback("")

    // Then
    expect(callback).toEqual({
      type: "success",
      provider: "cursor",
      key: "cli-session:cursor",
    })
  })

  it("fails callback when the Cursor access token is missing", async () => {
    // Given
    const auth = createCursorSessionAuth({ HOME: "/missing", PATH: "" })
    const method = auth.methods[0]
    if (method === undefined) {
      throw new Error("Cursor session method is missing")
    }

    // When
    if (method.authorize === undefined) {
      throw new Error("Cursor session authorize handler is missing")
    }
    const authorization = await method.authorize({})
    if (!("callback" in authorization)) {
      throw new Error("Cursor session authorization callback is missing")
    }
    const callback = await authorization.callback("")

    // Then
    expect(callback).toEqual({ type: "failed" })
  })
})

describe("Command Code session auth", () => {
  it("preserves the CLI session marker", async () => {
    // Given
    const auth = createCommandCodeSessionAuth({ COMMAND_CODE_API_KEY: "command-code-token" })
    const method = auth.methods[0]
    if (method === undefined) {
      throw new Error("Command Code session method is missing")
    }

    // When
    if (method.authorize === undefined) {
      throw new Error("Command Code session authorize handler is missing")
    }
    const authorization = await method.authorize({})
    if (!("callback" in authorization)) {
      throw new Error("Command Code session authorization callback is missing")
    }
    const callback = await authorization.callback("")

    // Then
    expect(callback).toEqual({
      type: "success",
      provider: "command-code",
      key: "cli-session:command-code",
    })
  })
})
