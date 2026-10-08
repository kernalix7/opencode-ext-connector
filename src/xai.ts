import type { Plugin as V1Plugin } from "@opencode-ai/plugin"

export const xaiAuthServer: V1Plugin = async (input, options) =>
  (await import("./server.js")).xaiAuthServer(input, options)
