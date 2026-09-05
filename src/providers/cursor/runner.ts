// Derived from Nomadcxx/opencode-cursor@8e14a26c1e080382f471a729436092ef72edf34e.
// Licensed under BSD-3-Clause. See THIRD_PARTY_NOTICES.md.

import { spawn } from "node:child_process"

import { OperationCancelledError } from "../../core/errors.js"

import { resolveCursorAgent } from "./auth.js"
import { extractCursorNdjsonText } from "./ndjson.js"

export async function runCursorAgentPrompt(
  env: Readonly<Record<string, string | undefined>>,
  prompt: string,
  signal: AbortSignal,
  cwd: string,
  model: string,
): Promise<string | null> {
  if (signal.aborted) {
    throw new OperationCancelledError("cursor-run-prompt")
  }
  const agent = await resolveCursorAgent(env, signal)
  if (agent === null) {
    return null
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(
      agent,
      [
        "--print",
        "--output-format",
        "stream-json",
        "--stream-partial-output",
        "--workspace",
        cwd,
        "--model",
        model,
        ...(env["CURSOR_ACP_FORCE"] === "false" ? [] : ["--force"]),
      ],
      {
        signal,
        stdio: ["pipe", "pipe", "pipe"],
      },
    )
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
      resolve(extractCursorNdjsonText(Buffer.concat(chunks).toString("utf8")))
    })
    child.stdin.write(prompt)
    child.stdin.end()
  })
}
