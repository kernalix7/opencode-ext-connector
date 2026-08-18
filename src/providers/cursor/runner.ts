// Derived from Nomadcxx/opencode-cursor@8e14a26c1e080382f471a729436092ef72edf34e.
// Licensed under BSD-3-Clause. See THIRD_PARTY_NOTICES.md.

import { spawn } from "node:child_process"

import { OperationCancelledError } from "../../core/errors"

import { resolveCursorAgent } from "./auth"

export async function runCursorAgentPrompt(
  env: Readonly<Record<string, string | undefined>>,
  prompt: string,
  signal: AbortSignal,
): Promise<string | null> {
  if (signal.aborted) {
    throw new OperationCancelledError("cursor-run-prompt")
  }
  const agent = await resolveCursorAgent(env, signal)
  if (agent === null) {
    return null
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(agent, ["--print", prompt], {
      signal,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const chunks: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk)
    })
    child.once("error", (error: Error) => {
      if (signal.aborted) {
        reject(new OperationCancelledError("cursor-run-prompt"))
        return
      }
      reject(error)
    })
    child.once("close", (code) => {
      if (signal.aborted) {
        reject(new OperationCancelledError("cursor-run-prompt"))
        return
      }
      if (code !== 0) {
        resolve(null)
        return
      }
      resolve(Buffer.concat(chunks).toString("utf8"))
    })
  })
}
