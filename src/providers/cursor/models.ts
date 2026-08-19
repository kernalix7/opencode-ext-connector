import { spawn } from "node:child_process"

import { parseModelIdList } from "../../catalog/parse-ids"
import { OperationCancelledError } from "../../core/errors"
import type { AdapterModel } from "../../core/models"

function stripAnsi(text: string): string {
  let output = ""
  let index = 0
  while (index < text.length) {
    if (text.charCodeAt(index) === 27 && text.at(index + 1) === "[") {
      index += 2
      while (index < text.length && text.at(index) !== "m") {
        index += 1
      }
      index += 1
      continue
    }
    output += text.at(index) ?? ""
    index += 1
  }
  return output
}

export function parseCursorModelOutput(stdout: string): readonly AdapterModel[] {
  const text = stripAnsi(stdout).trim()
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return parseModelIdList(JSON.parse(text))
    } catch {
      return []
    }
  }
  const ids: string[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.toLowerCase().startsWith("available")) {
      continue
    }
    const separator = trimmed.indexOf(" - ")
    const id = separator === -1 ? trimmed.split(/\s+/)[0] : trimmed.slice(0, separator).trim()
    if (id !== undefined && id.length > 0) {
      ids.push(id)
    }
  }
  return parseModelIdList(ids)
}

export type CursorModelsRun = (
  agent: string,
  args: readonly string[],
  signal: AbortSignal,
) => Promise<{ readonly code: number; readonly stdout: string }>

function runCursorModelsCommand(
  agent: string,
  args: readonly string[],
  signal: AbortSignal,
): Promise<{ readonly code: number; readonly stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(agent, [...args], { signal, stdio: ["ignore", "pipe", "pipe"] })
    const chunks: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk)
    })
    child.once("error", (error: Error) => {
      if (signal.aborted) {
        reject(new OperationCancelledError("cursor-list-models"))
        return
      }
      reject(error)
    })
    child.once("close", (code) => {
      if (signal.aborted) {
        reject(new OperationCancelledError("cursor-list-models"))
        return
      }
      resolve({ code: code ?? 1, stdout: Buffer.concat(chunks).toString("utf8") })
    })
  })
}

export async function listCursorModels(
  agent: string,
  signal: AbortSignal,
  run: CursorModelsRun = runCursorModelsCommand,
): Promise<readonly AdapterModel[]> {
  if (signal.aborted) {
    throw new OperationCancelledError("cursor-list-models")
  }
  const attempts = [["models"], ["--list-models"]]
  for (const args of attempts) {
    const result = await run(agent, args, signal)
    if (result.code !== 0) {
      continue
    }
    const models = parseCursorModelOutput(result.stdout)
    if (models.length > 0) {
      return models
    }
  }
  return []
}
