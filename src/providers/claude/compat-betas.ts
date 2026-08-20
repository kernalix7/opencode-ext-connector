// Derived from griffinmartin/opencode-claude-auth@0f0ff6f12c367339130cbfd250393863ed2c8d9e.
// Licensed under MIT. See THIRD_PARTY_NOTICES.md.

import { CLAUDE_BASE_BETAS, CLAUDE_LONG_CONTEXT_BETAS, claudeModelOverride } from "./compat-config"

const excludedBetas = new Map<string, Set<string>>()
let lastFlags: string | undefined = process.env["ANTHROPIC_BETA_FLAGS"]
let lastModelId: string | undefined

function requiredBetas(): string[] {
  return (process.env["ANTHROPIC_BETA_FLAGS"] ?? CLAUDE_BASE_BETAS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

export function claudeExcludedBetas(modelId: string): ReadonlySet<string> {
  const flags = process.env["ANTHROPIC_BETA_FLAGS"]
  if (flags !== lastFlags || (lastModelId !== undefined && lastModelId !== modelId)) {
    excludedBetas.clear()
  }
  lastFlags = flags
  lastModelId = modelId
  return excludedBetas.get(modelId) ?? new Set<string>()
}

export function excludeClaudeBeta(modelId: string, beta: string): void {
  const excluded = excludedBetas.get(modelId) ?? new Set<string>()
  excluded.add(beta)
  excludedBetas.set(modelId, excluded)
}

export function nextClaudeBetaToExclude(modelId: string): string | null {
  const excluded = claudeExcludedBetas(modelId)
  for (const beta of CLAUDE_LONG_CONTEXT_BETAS) {
    if (!excluded.has(beta)) {
      return beta
    }
  }
  return null
}

export function isClaudeLongContextError(body: string): boolean {
  return (
    body.includes("Extra usage is required for long context requests") ||
    body.includes("long context beta is not yet available") ||
    body.includes("You're out of extra usage")
  )
}

export function claudeModelBetas(modelId: string): readonly string[] {
  let betas = requiredBetas()
  const override = claudeModelOverride(modelId)
  if (override?.exclude !== undefined) {
    betas = betas.filter((beta) => !override.exclude?.includes(beta))
  }
  for (const beta of override?.add ?? []) {
    if (!betas.includes(beta)) {
      betas.push(beta)
    }
  }
  const excluded = claudeExcludedBetas(modelId)
  return betas.filter((beta) => !excluded.has(beta))
}
