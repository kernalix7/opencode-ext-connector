import { expect, it } from "bun:test"
import { createCommandCodeVersionResolver } from "../../../../src/providers/command-code/cli-version"
import { FakeHttpTransport } from "../../../support/http"

const signal = new AbortController().signal

it("uses the configured CLI version without a local binary or registry request", async () => {
  // Given
  const transport = new FakeHttpTransport()
  let installed = 0
  const resolve = createCommandCodeVersionResolver({
    env: { COMMAND_CODE_CLI_VERSION: "v1.30.0" },
    transport,
    readInstalledVersion: () => {
      installed += 1
      return "1.0.0"
    },
  })
  // When
  const version = await resolve(signal)
  // Then
  expect(version).toBe("1.30.0")
  expect(installed).toBe(0)
  expect(transport.requests).toHaveLength(0)
})

it("uses an available local version before the npm registry", async () => {
  // Given
  const transport = new FakeHttpTransport()
  const resolve = createCommandCodeVersionResolver({
    env: {},
    transport,
    readInstalledVersion: () => "2.1.0",
  })
  // When
  const version = await resolve(signal)
  // Then
  expect(version).toBe("2.1.0")
  expect(transport.requests).toHaveLength(0)
})

it("resolves the published npm version when the optional CLI is absent", async () => {
  // Given
  const transport = new FakeHttpTransport()
  transport.enqueueResponse({
    status: 200,
    headers: {},
    body: new TextEncoder().encode('{"version":"1.49.1"}'),
  })
  const resolve = createCommandCodeVersionResolver({
    env: {},
    transport,
    readInstalledVersion: () => null,
  })
  // When
  const version = await resolve(signal)
  // Then
  expect(version).toBe("1.49.1")
  expect(transport.requests[0]?.url).toBe("https://registry.npmjs.org/command-code/latest")
})
