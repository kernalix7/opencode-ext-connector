import { randomUUID } from "node:crypto"

import type { LanguageModelV3 } from "@ai-sdk/provider"

import type { HttpTransport } from "../core/http"
import { createClaudeLanguageModel } from "../providers/claude/language-model"
import { readCommandCodeAccessToken } from "../providers/command-code/auth"
import { createCommandCodeLanguageModel } from "../providers/command-code/language-model"
import { resolveCursorAgent } from "../providers/cursor/auth"
import { createCursorLanguageModel } from "../providers/cursor/language-model"
import { buildCursorPoolKey, type CursorAgentPool } from "../providers/cursor/pool"
import { runCursorAgentPrompt } from "../providers/cursor/runner"
import { extractCursorSessionId } from "../providers/cursor/session"

export type ConnectorLanguageDeps = {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly transport: HttpTransport
  readonly readClaudeToken: (signal: AbortSignal) => Promise<string | null>
  readonly cursorPool: CursorAgentPool
  readonly cursorSessions: Map<string, string>
  readonly commandCodeApiKey?: string
}

export function createConnectorLanguage(
  deps: ConnectorLanguageDeps,
): (providerID: string, modelId: string) => LanguageModelV3 | null {
  return (providerID: string, modelId: string): LanguageModelV3 | null => {
    if (providerID === "claude") {
      return createClaudeLanguageModel({
        modelId,
        transport: deps.transport,
        readAccessToken: deps.readClaudeToken,
      })
    }
    if (providerID === "cursor") {
      const workspace = process.cwd()
      return createCursorLanguageModel({
        modelId,
        runPrompt: (prompt, signal) =>
          runCursorAgentPrompt(deps.env, prompt, signal, workspace, modelId),
        streamNdjson: async function* (prompt, signal, sessionKey, incrementalPrompt) {
          const agent = await resolveCursorAgent(deps.env, signal)
          if (agent === null) {
            return
          }
          const resumeValue = deps.env["CURSOR_ACP_SESSION_RESUME"]?.toLowerCase()
          const resumeEnabled =
            resumeValue === "1" ||
            resumeValue === "true" ||
            resumeValue === "on" ||
            resumeValue === "yes"
          const canResume = resumeEnabled && sessionKey !== null
          const scopedSessionKey = canResume ? sessionKey : randomUUID()
          const poolKey = buildCursorPoolKey(workspace, modelId, scopedSessionKey)
          const resume = canResume ? deps.cursorSessions.get(poolKey) : undefined
          const session = await deps.cursorPool.acquire({
            workspace,
            model: modelId,
            executable: agent,
            sessionKey: scopedSessionKey,
            ...(resume !== undefined ? { resume } : {}),
          })
          if (signal.aborted) {
            session.child.cancel("aborted")
            return
          }
          const onAbort = (): void => {
            session.child.cancel("aborted")
          }
          signal.addEventListener("abort", onAbort, { once: true })
          session.child.writePrompt(
            resume === undefined || incrementalPrompt === null ? prompt : incrementalPrompt,
          )
          let completed = false
          try {
            for await (const line of session.child.lines) {
              const sessionId = extractCursorSessionId(line)
              if (sessionId !== null && canResume) {
                deps.cursorSessions.set(poolKey, sessionId)
              }
              yield line
            }
            completed = true
          } finally {
            if (!completed && !signal.aborted) {
              session.child.cancel("tool-intercepted")
            }
            signal.removeEventListener("abort", onAbort)
          }
        },
      })
    }
    if (providerID === "command-code") {
      return createCommandCodeLanguageModel({
        modelId,
        transport: deps.transport,
        readAccessToken: (signal) =>
          deps.commandCodeApiKey === undefined
            ? readCommandCodeAccessToken(deps.env, signal)
            : Promise.resolve(deps.commandCodeApiKey),
      })
    }
    return null
  }
}
