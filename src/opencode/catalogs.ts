import { parseModelId } from "../core/ids"
import type { AdapterModel } from "../core/models"

function models(ids: readonly string[]): readonly AdapterModel[] {
  return ids.map((id) => ({ id: parseModelId(id) }))
}

export const CLAUDE_CATALOG: readonly AdapterModel[] = models([
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
])

export const CURSOR_CATALOG: readonly AdapterModel[] = models([
  "auto",
  "composer-1.5",
  "opus-4.6-thinking",
  "opus-4.6",
  "sonnet-4.6",
  "sonnet-4.6-thinking",
  "opus-4.5",
  "opus-4.5-thinking",
  "sonnet-4.5",
  "sonnet-4.5-thinking",
  "gpt-5.4-high",
  "gpt-5.4-medium",
  "gpt-5.3-codex",
  "gpt-5.2",
  "gemini-3.1-pro",
  "gemini-3-pro",
  "gemini-3-flash",
  "grok",
  "kimi-k2.5",
])

export const COMMAND_CODE_CATALOG: readonly AdapterModel[] = models([
  "deepseek/deepseek-v4-pro",
  "deepseek/deepseek-v4-flash",
  "zai-org/GLM-5.2",
  "zai-org/GLM-5.2-Fast",
  "zai-org/GLM-5.1",
  "zai-org/GLM-5",
  "MiniMaxAI/MiniMax-M3",
  "MiniMaxAI/MiniMax-M2.7",
  "MiniMaxAI/MiniMax-M2.5",
  "moonshotai/Kimi-K3",
  "moonshotai/Kimi-K2.7-Code",
  "moonshotai/Kimi-K2.7-Code-Highspeed",
  "moonshotai/Kimi-K2.6",
  "moonshotai/Kimi-K2.5",
  "Qwen/Qwen3.7-Max",
  "Qwen/Qwen3.7-Plus",
  "Qwen/Qwen3.6-Max-Preview",
  "Qwen/Qwen3.6-Plus",
  "stepfun/Step-3.7-Flash",
  "stepfun/Step-3.5-Flash",
  "xiaomi/mimo-v2.5-pro",
  "xiaomi/mimo-v2.5",
  "xai/grok-4.5",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "thinkingmachines/inkling",
  "tencent/Hy3",
])
