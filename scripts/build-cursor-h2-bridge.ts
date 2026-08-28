import { join } from "node:path"

export type CursorH2BridgeBuildOptions = {
  readonly outdir?: string
}

export class CursorH2BridgeBuildError extends Error {
  public constructor(logs: readonly unknown[]) {
    super(`Cursor h2 bridge build failed\n${logs.map(String).join("\n")}`)
    this.name = "CursorH2BridgeBuildError"
  }
}

export async function buildCursorH2Bridge(options: CursorH2BridgeBuildOptions = {}): Promise<void> {
  const projectRoot = join(import.meta.dir, "..")
  const result = await Bun.build({
    entrypoints: [join(projectRoot, "src", "providers", "cursor", "h2-bridge.ts")],
    format: "esm",
    outdir: options.outdir ?? join(projectRoot, "dist", "providers", "cursor"),
    root: join(projectRoot, "src", "providers", "cursor"),
    sourcemap: "none",
    target: "node",
  })
  if (!result.success) throw new CursorH2BridgeBuildError(result.logs)
}

if (import.meta.main) await buildCursorH2Bridge()
