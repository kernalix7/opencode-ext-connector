import type { AsyncDisposableHandle } from "./lifecycle"

export type ProcessCommand = {
  readonly executable: string
  readonly arguments: readonly string[]
  readonly cwd: string | null
}

export type ProcessExit =
  | { readonly kind: "code"; readonly code: number }
  | { readonly kind: "signal"; readonly signal: string }

export interface SupervisedProcess extends AsyncDisposableHandle {
  wait(signal: AbortSignal): Promise<ProcessExit>
  terminate(): Promise<void>
}

export interface ProcessSupervisor extends AsyncDisposableHandle {
  start(command: ProcessCommand, signal: AbortSignal): Promise<SupervisedProcess>
}
