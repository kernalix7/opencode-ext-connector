// Derived from Nomadcxx/opencode-cursor@8e14a26c1e080382f471a729436092ef72edf34e.
// Licensed under BSD-3-Clause. See THIRD_PARTY_NOTICES.md.

import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"

const TOOL_ALIASES: Readonly<Record<string, string>> = {
  runcommand: "bash",
  executecommand: "bash",
  runterminalcommand: "bash",
  terminalcommand: "bash",
  shellcommand: "bash",
  shell: "bash",
  terminal: "bash",
  bashcommand: "bash",
  runbash: "bash",
  executebash: "bash",
  strreplace: "edit",
  writefile: "write",
  findfiles: "glob",
  searchfiles: "glob",
  globfiles: "glob",
  fileglob: "glob",
  matchfiles: "glob",
  createdirectory: "mkdir",
  makedirectory: "mkdir",
  mkdirp: "mkdir",
  createdir: "mkdir",
  makefolder: "mkdir",
  delete: "rm",
  deletefile: "rm",
  deletepath: "rm",
  deletedirectory: "rm",
  remove: "rm",
  removefile: "rm",
  removepath: "rm",
  unlink: "rm",
  rmdir: "rm",
  getfileinfo: "stat",
  fileinfo: "stat",
  filestat: "stat",
  pathinfo: "stat",
  listdirectory: "ls",
  listfiles: "ls",
  listdir: "ls",
  readdir: "ls",
  updatetodos: "todowrite",
  updatetodostoolcall: "todowrite",
  todowritetoolcall: "todowrite",
  writetodos: "todowrite",
  todowritefn: "todowrite",
  readtodos: "todoread",
  readtodostoolcall: "todoread",
  todoreadtoolcall: "todoread",
  callomoagent: "call_omo_agent",
  callagent: "call_omo_agent",
  invokeagent: "call_omo_agent",
  delegatetask: "task",
  delegate: "task",
  runtask: "task",
  subagent: "task",
  useskill: "skill",
  invokeskill: "skill",
  runskill: "skill",
  skillmcp: "skill_mcp",
  runmcpskill: "skill_mcp",
  invokeskillmcp: "skill_mcp",
  askquestion: "question",
  askuser: "question",
  askuserquestion: "question",
  askquestions: "question",
  promptuser: "question",
}

const ARGUMENT_ALIASES: Readonly<Record<string, string>> = {
  filepath: "path",
  filename: "path",
  file: "path",
  targetpath: "path",
  directorypath: "path",
  dir: "path",
  folder: "path",
  directory: "path",
  targetdirectory: "path",
  targetfile: "path",
  globpattern: "pattern",
  filepattern: "pattern",
  searchpattern: "pattern",
  includepattern: "include",
  workingdirectory: "cwd",
  workdir: "cwd",
  currentdirectory: "cwd",
  cmd: "command",
  script: "command",
  shellcommand: "command",
  terminalcommand: "command",
  contents: "content",
  text: "content",
  body: "content",
  data: "content",
  payload: "content",
  streamcontent: "content",
  recursive: "force",
  oldstring: "old_string",
  newstring: "new_string",
  subagenttype: "subagent_type",
}

function stringField(value: object, key: string): string | null {
  if (!(key in value)) {
    return null
  }
  const field = Reflect.get(value, key)
  return typeof field === "string" && field.length > 0 ? field : null
}

function toolNameFromKey(key: string): string {
  return key.endsWith("ToolCall") ? key.slice(0, -"ToolCall".length) : key
}

function normalizeToolName(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z0-9]/g, "")
}

function resolveToolName(name: string, allowed: ReadonlyMap<string, unknown>): string | null {
  if (allowed.has(name)) {
    return name
  }
  const normalized = normalizeToolName(name)
  const alias = normalizeToolName(TOOL_ALIASES[normalized] ?? normalized)
  for (const candidate of allowed.keys()) {
    const normalizedCandidate = normalizeToolName(candidate)
    if (
      normalizedCandidate === normalized ||
      normalizedCandidate === alias ||
      normalizedCandidate === normalizeToolName(`oc_${alias}`)
    ) {
      return candidate
    }
  }
  return null
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    result[key] = Reflect.get(value, key)
  }
  return result
}

function normalizeArguments(args: unknown, schema: unknown): unknown {
  const input = objectRecord(args)
  const schemaRecord = objectRecord(schema)
  const properties = objectRecord(schemaRecord?.["properties"])
  if (input === null || properties === null) {
    return args
  }
  const propertyByNormalized = new Map<string, string>()
  for (const property of Object.keys(properties)) {
    const normalizedProperty = normalizeToolName(property)
    propertyByNormalized.set(ARGUMENT_ALIASES[normalizedProperty] ?? normalizedProperty, property)
  }
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = normalizeToolName(key)
    const alias = ARGUMENT_ALIASES[normalizedKey] ?? normalizedKey
    const target = (key in properties ? key : undefined) ?? propertyByNormalized.get(alias) ?? key
    if (!(target in normalized)) {
      normalized[target] = value
    }
  }
  if (schemaRecord?.["additionalProperties"] === false) {
    for (const key of Object.keys(normalized)) {
      if (!(key in properties)) {
        delete normalized[key]
      }
    }
  }
  return normalized
}

function nestedToolCall(value: object): { readonly name: string; readonly args: unknown } | null {
  if (!("tool_call" in value)) {
    return null
  }
  const payload = Reflect.get(value, "tool_call")
  if (typeof payload !== "object" || payload === null) {
    return null
  }
  const entries = Object.entries(payload)
  const first = entries.at(0)
  if (first === undefined) {
    return null
  }
  const [key, nested] = first
  if (typeof nested !== "object" || nested === null) {
    return { name: toolNameFromKey(key), args: {} }
  }
  const args = "args" in nested ? Reflect.get(nested, "args") : nested
  return { name: toolNameFromKey(key), args }
}

export function cursorToolParts(
  parsed: object,
  allowedTools: ReadonlyMap<string, unknown>,
): readonly LanguageModelV3StreamPart[] {
  const type = stringField(parsed, "type")
  if (type !== "tool_call") {
    return []
  }
  const subtype = stringField(parsed, "subtype") ?? "started"
  const id = stringField(parsed, "call_id") ?? stringField(parsed, "id") ?? "tool-1"
  const flatName = stringField(parsed, "name") ?? stringField(parsed, "toolName")
  const nested = nestedToolCall(parsed)
  const rawToolName = flatName ?? nested?.name ?? "unknown"
  const toolName = resolveToolName(rawToolName, allowedTools)
  const args = "arguments" in parsed ? Reflect.get(parsed, "arguments") : nested?.args
  if (toolName === null) {
    return subtype === "started"
      ? [
          {
            type: "tool-call",
            toolCallId: id,
            toolName: rawToolName,
            input: JSON.stringify(args ?? {}),
            providerExecuted: true,
          },
        ]
      : []
  }
  const input = JSON.stringify(normalizeArguments(args ?? {}, allowedTools.get(toolName)))
  if (subtype === "delta") {
    return [{ type: "tool-input-delta", id, delta: input }]
  }
  if (subtype === "completed") {
    return [{ type: "tool-input-end", id }]
  }
  return [
    { type: "tool-input-start", id, toolName },
    { type: "tool-input-delta", id, delta: input },
    { type: "tool-input-end", id },
    { type: "tool-call", toolCallId: id, toolName, input, providerExecuted: false },
  ]
}
