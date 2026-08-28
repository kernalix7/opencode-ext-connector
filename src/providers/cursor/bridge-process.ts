import { Buffer } from "node:buffer"
import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { OperationCancelledError } from "../../core/errors"
import { type AsyncDisposableHandle, createAsyncDisposable } from "../../core/lifecycle"

const execFileAsync = promisify(execFile)
const maximumStderrBytes = 16 * 1024
const preservedEnvironment = [
  "PATH",
  "SystemRoot",
  "WINDIR",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const

export type CursorBridgeUnavailableReason =
  | "node-unavailable"
  | "malformed-node-version"
  | "unsupported-node"
  | "spawn-failed"

export class CursorBridgeUnavailableError extends Error {
  public override readonly name = "CursorBridgeUnavailableError"
  public readonly code = "CURSOR_BRIDGE_UNAVAILABLE"
  public constructor(public readonly reason: CursorBridgeUnavailableReason) {
    super("Cursor bridge is unavailable")
  }
}

export type CursorBridgeProcessErrorReason =
  | "stdin-closed"
  | "stdout-failed"
  | "child-exited"
  | "termination-failed"

export class CursorBridgeProcessError extends Error {
  public override readonly name = "CursorBridgeProcessError"
  public readonly code = "CURSOR_BRIDGE_PROCESS_ERROR"
  public readonly detail: string
  public constructor(
    public readonly reason: CursorBridgeProcessErrorReason,
    detail: string,
  ) {
    super("Cursor bridge process failed")
    this.detail = redactProcessText(detail)
  }
}

export type CursorBridgeProcessExit = {
  readonly code: number | null
  readonly signal: string | null
  readonly stderr: string
}

export interface CursorBridgeProcess extends AsyncDisposableHandle {
  readonly pid: number
  readonly stdout: AsyncIterable<string>
  write(data: string, signal: AbortSignal): Promise<void>
  wait(): Promise<CursorBridgeProcessExit>
  terminate(): Promise<void>
}

export interface CursorBridgeProcessFactory {
  start(signal: AbortSignal): Promise<CursorBridgeProcess>
}

export type CursorBridgeSpawnInput = {
  readonly executable: string
  readonly arguments: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

export type NodeCursorBridgeProcessFactoryOptions = {
  readonly nodeExecutable?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly childUrl?: URL
  readonly endpoint?: string
  readonly probeVersion?: (executable: string, signal: AbortSignal) => Promise<string>
  readonly spawnBridge?: (
    input: CursorBridgeSpawnInput,
    signal: AbortSignal,
  ) => Promise<CursorBridgeProcess>
}

function safeEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  const env: Record<string, string> = {}
  for (const name of preservedEnvironment) {
    const value = source[name]
    if (value !== undefined) env[name] = value
  }
  return env
}

function redactProcessText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(authorization|cookie|token|api[-_]?key|password|secret)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .replace(/([?&][^=&#\s]+)=([^&#\s]*)/g, "$1=[REDACTED]")
}

function parseNodeMajor(version: string): number | null {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?\r?\n?$/.exec(
    version,
  )
  if (match === null) return null
  const major = Number(match[1])
  return Number.isSafeInteger(major) ? major : null
}

async function defaultProbeVersion(
  executable: string,
  signal: AbortSignal,
  env: Readonly<Record<string, string>>,
): Promise<string> {
  const result = await execFileAsync(executable, ["--version"], {
    encoding: "utf8",
    env,
    signal,
    windowsHide: true,
  })
  return result.stdout
}

async function* readStdout(child: ChildProcessWithoutNullStreams): AsyncIterable<string> {
  const decoder = new TextDecoder()
  for await (const value of child.stdout) {
    const chunk: unknown = value
    if (!Buffer.isBuffer(chunk)) {
      throw new CursorBridgeProcessError("stdout-failed", "non-buffer stdout chunk")
    }
    yield decoder.decode(chunk, { stream: true })
  }
  const trailing = decoder.decode()
  if (trailing.length > 0) yield trailing
}

class NodeCursorBridgeProcess implements CursorBridgeProcess {
  public readonly pid: number
  public readonly stdout: AsyncIterable<string>
  private readonly exit = Promise.withResolvers<CursorBridgeProcessExit>()
  private readonly disposal: AsyncDisposableHandle
  private readonly stderr: Buffer[] = []
  private stderrBytes = 0

  public constructor(private readonly child: ChildProcessWithoutNullStreams) {
    const pid = child.pid
    if (pid === undefined) throw new CursorBridgeUnavailableError("spawn-failed")
    this.pid = pid
    this.stdout = readStdout(child)
    child.stderr.on("data", (value: unknown) => {
      if (!Buffer.isBuffer(value) || this.stderrBytes >= maximumStderrBytes) return
      const remaining = maximumStderrBytes - this.stderrBytes
      const chunk = value.subarray(0, remaining)
      this.stderr.push(chunk)
      this.stderrBytes += chunk.byteLength
    })
    child.once("exit", (code, signal) => {
      this.exit.resolve({
        code,
        signal,
        stderr: redactProcessText(Buffer.concat(this.stderr).toString("utf8")),
      })
    })
    this.disposal = createAsyncDisposable(() => this.terminate())
  }

  public write(data: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new OperationCancelledError("write-cursor-bridge"))
    const deferred = Promise.withResolvers<void>()
    const onAbort = (): void => deferred.reject(new OperationCancelledError("write-cursor-bridge"))
    signal.addEventListener("abort", onAbort, { once: true })
    this.child.stdin.write(data, (error) => {
      signal.removeEventListener("abort", onAbort)
      if (error === null || error === undefined) deferred.resolve()
      else deferred.reject(new CursorBridgeProcessError("stdin-closed", "stdin write failed"))
    })
    return deferred.promise
  }
  public wait(): Promise<CursorBridgeProcessExit> {
    return this.exit.promise
  }
  public async terminate(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return
    this.child.stdin.end()
    this.child.kill("SIGTERM")
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      this.exit.promise,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 1_000)
        timer.unref()
      }),
    ])
    if (timer !== undefined) clearTimeout(timer)
    if (this.child.exitCode === null && this.child.signalCode === null) {
      if (!this.child.kill("SIGKILL")) {
        throw new CursorBridgeProcessError("termination-failed", "failed to signal child")
      }
      await this.exit.promise
    }
  }
  public dispose(): Promise<void> {
    return this.disposal.dispose()
  }
  public [Symbol.asyncDispose](): Promise<void> {
    return this.disposal.dispose()
  }
}

async function defaultSpawnBridge(
  input: CursorBridgeSpawnInput,
  signal: AbortSignal,
): Promise<CursorBridgeProcess> {
  const child = spawn(input.executable, [...input.arguments], {
    env: input.env,
    signal,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve)
    child.once("error", reject)
  })
  return new NodeCursorBridgeProcess(child)
}

export function createNodeCursorBridgeProcessFactory(
  options: NodeCursorBridgeProcessFactoryOptions = {},
): CursorBridgeProcessFactory {
  const executable = options.nodeExecutable ?? "node"
  const childUrl = options.childUrl ?? new URL("./h2-bridge.js", import.meta.url)
  const env = safeEnvironment(options.env ?? process.env)
  const probeVersion =
    options.probeVersion ?? ((target, signal) => defaultProbeVersion(target, signal, env))
  const spawnBridge = options.spawnBridge ?? defaultSpawnBridge
  return {
    async start(signal: AbortSignal): Promise<CursorBridgeProcess> {
      if (signal.aborted) throw new OperationCancelledError("start-cursor-bridge")
      let version: string
      try {
        version = await probeVersion(executable, signal)
      } catch (error) {
        if (signal.aborted) throw new OperationCancelledError("start-cursor-bridge")
        void error
        throw new CursorBridgeUnavailableError("node-unavailable")
      }
      const major = parseNodeMajor(version)
      if (major === null) throw new CursorBridgeUnavailableError("malformed-node-version")
      if (major < 22) throw new CursorBridgeUnavailableError("unsupported-node")
      const childPath = fileURLToPath(childUrl)
      const arguments_ =
        options.endpoint === undefined ? [childPath] : [childPath, options.endpoint]
      try {
        return await spawnBridge({ executable, arguments: arguments_, env }, signal)
      } catch (error) {
        if (signal.aborted) throw new OperationCancelledError("start-cursor-bridge")
        void error
        throw new CursorBridgeUnavailableError("spawn-failed")
      }
    },
  }
}
