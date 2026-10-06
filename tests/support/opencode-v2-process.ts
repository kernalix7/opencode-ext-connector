import { z } from "zod"

const startupUrlSchema = z.url()
const passwordSchema = z.string().min(1)
const startupUrlPattern = /server listening on (http:\/\/127\.0\.0\.1:\d+)/
const passwordPattern = /server password (\S+)/
const diagnosticLineLimit = 80
const defaultStartupTimeoutMs = 15_000
const defaultCloseTimeoutMs = 2_000

export class OpenCodeV2ProcessStartError extends Error {
  public override readonly name = "OpenCodeV2ProcessStartError"

  public constructor(
    message: string,
    public readonly diagnostics: string,
    public readonly exitCode: number | null,
  ) {
    super(message)
  }
}

export type OpenCodeV2ProcessOptions = {
  readonly binary: string
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  readonly startupTimeoutMs?: number
  readonly closeTimeoutMs?: number
}

export type OpenCodeV2Process = {
  readonly diagnostics: () => string
  readonly exitCode: number | null
  readonly exited: Promise<number>
  readonly password: string
  readonly pid: number
  readonly url: string
  close(): Promise<void>
}

type ReadyEndpoint = {
  readonly password: string
  readonly url: string
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code
}

function parseStartupUrl(line: string): string | null {
  const candidate = line.match(startupUrlPattern)?.[1]
  if (candidate === undefined) return null
  const parsed = startupUrlSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

function parsePassword(line: string): string | null {
  const candidate = line.match(passwordPattern)?.[1]
  if (candidate === undefined) return null
  const parsed = passwordSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

async function readOutput(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const decoder = new TextDecoder()
  let pending = ""
  for await (const chunk of stream) {
    const lines = `${pending}${decoder.decode(chunk, { stream: true })}`.split("\n")
    pending = lines.pop() ?? ""
    for (const line of lines) onLine(line)
  }
  const finalLine = `${pending}${decoder.decode()}`
  if (finalLine.length > 0) onLine(finalLine)
}

function signal(child: Bun.Subprocess, name: NodeJS.Signals): void {
  try {
    child.kill(name)
  } catch (error: unknown) {
    if (isErrno(error, "ESRCH")) return
    throw error
  }
}

export async function startOpenCodeV2(
  options: OpenCodeV2ProcessOptions,
): Promise<OpenCodeV2Process> {
  const child = Bun.spawn(
    [options.binary, "serve", "--hostname", "127.0.0.1", "--port", "0", "--log-level", "error"],
    { cwd: options.cwd, env: { ...options.env }, stderr: "pipe", stdout: "pipe" },
  )
  const lines: string[] = []
  const remember = (line: string): void => {
    lines.push(line.replace(passwordPattern, "server password [redacted]"))
    if (lines.length > diagnosticLineLimit) lines.shift()
  }
  const diagnostics = (): string => lines.join("\n")
  let url: string | undefined
  let password: string | undefined
  const started = Promise.withResolvers<ReadyEndpoint>()
  const observe = (line: string): void => {
    remember(line)
    const parsedUrl = parseStartupUrl(line)
    if (parsedUrl !== null) url = parsedUrl
    const parsedPassword = parsePassword(line)
    if (parsedPassword !== null) password = parsedPassword
    if (url !== undefined && password !== undefined) started.resolve({ password, url })
  }
  const drains = [readOutput(child.stdout, observe), readOutput(child.stderr, observe)]
  let observedExitCode: number | null = null
  const processExit = child.exited.then((code) => {
    observedExitCode = code
    return code
  })
  const closeTimeoutMs = options.closeTimeoutMs ?? defaultCloseTimeoutMs
  const shutdown = async (): Promise<void> => {
    if (child.exitCode !== null) {
      await processExit
      await Promise.all(drains)
      return
    }
    signal(child, "SIGTERM")
    const exited = await Promise.race([
      processExit.then(() => true),
      Bun.sleep(closeTimeoutMs).then(() => false),
    ])
    if (!exited && child.exitCode === null) signal(child, "SIGKILL")
    await processExit
    await Promise.all(drains)
  }
  const timeout = AbortSignal.timeout(options.startupTimeoutMs ?? defaultStartupTimeoutMs)
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout.addEventListener(
      "abort",
      () => {
        reject(
          new OpenCodeV2ProcessStartError(
            "OpenCode V2 did not report its server URL and password",
            diagnostics(),
            observedExitCode,
          ),
        )
      },
      { once: true },
    )
  })
  const exitedBeforeStart = processExit.then((code) => {
    throw new OpenCodeV2ProcessStartError(
      `OpenCode V2 exited before startup with code ${code}`,
      diagnostics(),
      code,
    )
  })
  let ready: ReadyEndpoint
  try {
    ready = await Promise.race([started.promise, timedOut, exitedBeforeStart])
  } catch (error: unknown) {
    await shutdown()
    throw error
  }
  let closePromise: Promise<void> | undefined
  return {
    diagnostics,
    get exitCode(): number | null {
      return observedExitCode
    },
    exited: processExit,
    password: ready.password,
    pid: child.pid,
    url: ready.url,
    close: (): Promise<void> => {
      closePromise ??= shutdown()
      return closePromise
    },
  }
}
