import type { Plugin as V1Plugin } from "@opencode-ai/plugin"

export const connectorServer: V1Plugin = async (input, options) =>
  (await import("./server.js")).connectorServer(input, options)

export const claudeAuthServer: V1Plugin = async (input, options) =>
  (await import("./server.js")).claudeAuthServer(input, options)

export const cursorAuthServer: V1Plugin = async (input, options) =>
  (await import("./server.js")).cursorAuthServer(input, options)

export const commandCodeAuthServer: V1Plugin = async (input, options) =>
  (await import("./server.js")).commandCodeAuthServer(input, options)

export const ollamaAuthServer: V1Plugin = async (input, options) =>
  (await import("./server.js")).ollamaAuthServer(input, options)
