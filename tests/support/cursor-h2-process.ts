import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { join } from "node:path"

import {
  type BridgeCommand,
  type BridgeEvent,
  createBridgeEventLineDecoder,
  serializeBridgeCommand,
} from "../../src/providers/cursor/bridge-protocol"
import { getTestPackageDist, getTestPackageRoot } from "./test-package"

const packageRoot = getTestPackageRoot()
const childPath = join(getTestPackageDist(), "providers", "cursor", "h2-bridge.js")
const children = new Set<ChildProcessWithoutNullStreams>()

export type RunningCursorH2Bridge = {
  readonly child: ChildProcessWithoutNullStreams
  readonly events: BridgeEvent[]
  readonly waitFor: (predicate: (event: BridgeEvent) => boolean) => Promise<BridgeEvent>
}

export function startCursorH2Bridge(endpoint: string): RunningCursorH2Bridge {
  const child = spawn("node", [childPath, endpoint], {
    cwd: packageRoot,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  })
  children.add(child)
  const decoder = createBridgeEventLineDecoder()
  const events: BridgeEvent[] = []
  const stderr: Buffer[] = []
  const waiters: Array<{
    readonly predicate: (event: BridgeEvent) => boolean
    readonly resolve: (event: BridgeEvent) => void
    readonly reject: (error: Error) => void
  }> = []
  child.stdout.setEncoding("utf8")
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
  child.stdout.on("data", (chunk: string) => {
    for (const event of decoder.push(chunk)) {
      events.push(event)
      const index = waiters.findIndex((waiter) => waiter.predicate(event))
      const waiter = index < 0 ? undefined : waiters.splice(index, 1)[0]
      waiter?.resolve(event)
    }
  })
  child.once("exit", (code) => {
    for (const waiter of waiters.splice(0)) {
      waiter.reject(
        new TypeError(
          `bridge child exited before event with code ${code ?? "signal"}: ${Buffer.concat(stderr).toString("utf8")}`,
        ),
      )
    }
  })
  return {
    child,
    events,
    waitFor: (predicate): Promise<BridgeEvent> => {
      const existing = events.find(predicate)
      return existing === undefined
        ? new Promise((resolve, reject) => waiters.push({ predicate, resolve, reject }))
        : Promise.resolve(existing)
    },
  }
}

export function sendBridgeCommand(
  child: ChildProcessWithoutNullStreams,
  command: BridgeCommand,
): void {
  child.stdin.write(serializeBridgeCommand(command))
}

export async function cursorH2BridgeExitCode(
  child: ChildProcessWithoutNullStreams,
): Promise<number | null> {
  if (child.exitCode !== null) {
    children.delete(child)
    return child.exitCode
  }
  const result = await new Promise<{ readonly code: number | null }>((resolve) => {
    child.once("exit", (code) => resolve({ code }))
  })
  children.delete(child)
  return result.code
}

export function killCursorH2BridgeChildren(): void {
  for (const child of children) {
    child.kill("SIGKILL")
  }
  children.clear()
}
