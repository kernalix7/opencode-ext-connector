import { z } from "zod"

const startupUrlSchema = z.url()
const portSchema = z.number().int().min(1).max(65_535)
const startupUrlPattern = /http:\/\/127\.0\.0\.1:\d+/

class OpenCodeProcessStartError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = "OpenCodeProcessStartError"
  }
}

function parseStartupUrl(line: string): string | null {
  const candidate = line.match(startupUrlPattern)?.at(0)
  if (candidate === undefined) {
    return null
  }
  const parsed = startupUrlSchema.safeParse(candidate)
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
    for (const line of lines) {
      onLine(line)
    }
  }
  const finalLine = `${pending}${decoder.decode()}`
  if (finalLine.length > 0) {
    onLine(finalLine)
  }
}

export type OpenCodeProcessOptions = {
  readonly binary: string
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  readonly startupTimeoutMs?: number
}

export type OpenCodeProcess = {
  readonly exitCode: number | null
  readonly exited: Promise<number>
  readonly pid: number
  readonly url: string
  close(): Promise<void>
}

export async function startOpenCode(options: OpenCodeProcessOptions): Promise<OpenCodeProcess> {
  const reservation = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(null, { status: 503 }),
  })
  const port = portSchema.parse(reservation.port)
  await reservation.stop(true)
  const process = Bun.spawn(
    [
      options.binary,
      "serve",
      "--hostname",
      "127.0.0.1",
      "--port",
      port.toString(),
      "--print-logs",
      "--log-level",
      "ERROR",
    ],
    {
      cwd: options.cwd,
      env: { ...options.env },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const started = Promise.withResolvers<string>()
  const observe = (line: string): void => {
    const url = parseStartupUrl(line)
    if (url !== null) {
      started.resolve(url)
    }
  }
  const drains = [readOutput(process.stdout, observe), readOutput(process.stderr, observe)]
  let observedExitCode: number | null = null
  const processExit = process.exited.then((code) => {
    observedExitCode = code
    return code
  })
  const timeout = AbortSignal.timeout(options.startupTimeoutMs ?? 10_000)
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout.addEventListener(
      "abort",
      () => reject(new OpenCodeProcessStartError("OpenCode did not report its server URL")),
      { once: true },
    )
  })
  const exitedBeforeStart = processExit.then((code) => {
    throw new OpenCodeProcessStartError(`OpenCode exited before startup with code ${code}`)
  })
  const shutdown = async (): Promise<void> => {
    if (process.exitCode === null) {
      process.kill("SIGKILL")
    }
    await processExit
    await Promise.all(drains)
  }
  let url: string
  try {
    url = await Promise.race([started.promise, timedOut, exitedBeforeStart])
  } catch (error: unknown) {
    await shutdown()
    throw error
  }
  let closePromise: Promise<void> | undefined
  return {
    get exitCode(): number | null {
      return observedExitCode
    },
    exited: processExit,
    pid: process.pid,
    url,
    close: (): Promise<void> => {
      if (closePromise === undefined) {
        closePromise = shutdown()
      }
      return closePromise
    },
  }
}
