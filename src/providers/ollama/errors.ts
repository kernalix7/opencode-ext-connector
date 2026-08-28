export type OllamaCatalogErrorKind = "invalid-data" | "transport-error"

export class OllamaCatalogError extends Error {
  public override readonly name = "OllamaCatalogError"

  public constructor(
    public readonly operation: "cloud-family" | "cloud-search" | "local-tags",
    public readonly kind: OllamaCatalogErrorKind,
  ) {
    super("Ollama catalog request failed")
  }
}

export type OllamaGenerationOperation =
  | "chat"
  | "chat-response"
  | "model-unavailable"
  | "prompt"
  | "pull"
  | "pull-response"
  | "tags"

export class OllamaGenerationError extends Error {
  public override readonly name = "OllamaGenerationError"
  public readonly code = "OLLAMA_GENERATION_ERROR"

  public constructor(public readonly operation: OllamaGenerationOperation) {
    super("Ollama generation failed")
  }
}
