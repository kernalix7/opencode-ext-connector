export type PackageCommand = {
  readonly operation: "extract" | "inspect-exports" | "node-consumer"
  readonly command: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
}

class PackageE2eCommandError extends Error {
  public override readonly name = "PackageE2eCommandError"

  public constructor(
    public readonly operation: PackageCommand["operation"],
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(`${operation} failed with code ${exitCode}: ${stderr.trim()}`)
  }
}

export async function runPackageCommand(packageCommand: PackageCommand): Promise<string> {
  const child = Bun.spawn([...packageCommand.command], {
    cwd: packageCommand.cwd,
    env: { ...packageCommand.env },
    stderr: "pipe",
    stdout: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new PackageE2eCommandError(packageCommand.operation, exitCode, stderr)
  return stdout
}
