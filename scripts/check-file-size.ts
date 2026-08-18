import { readdir, readFile, stat } from "node:fs/promises"
import { extname, join } from "node:path"

import * as ts from "typescript"

export type FileSizeViolation = {
  readonly filePath: string
  readonly pureLines: number
  readonly maximumLines: number
}

const SOURCE_EXTENSIONS = new Set([".cts", ".mts", ".ts", ".tsx"])
const IGNORED_DIRECTORIES = new Set([
  ".codegraph",
  ".git",
  ".omo",
  "coverage",
  "dist",
  "node_modules",
])

export function countPureLines(sourceText: string): number {
  const sourceFile = ts.createSourceFile("source.ts", sourceText, ts.ScriptTarget.Latest, true)
  const lineStarts = sourceFile.getLineStarts()
  const codeLines = new Set<number>()
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    sourceText,
  )

  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token >= ts.SyntaxKind.FirstTriviaToken && token <= ts.SyntaxKind.LastTriviaToken) {
      continue
    }
    const tokenStart = scanner.getTokenPos()
    const tokenEnd = scanner.getTextPos()
    const startLine = sourceFile.getLineAndCharacterOfPosition(tokenStart).line
    const endLine = sourceFile.getLineAndCharacterOfPosition(tokenEnd).line

    for (let line = startLine; line <= endLine; line += 1) {
      const lineStart = lineStarts.at(line)
      if (lineStart === undefined) {
        continue
      }
      const lineEnd = lineStarts.at(line + 1) ?? sourceText.length
      const fragment = sourceText.slice(
        Math.max(tokenStart, lineStart),
        Math.min(tokenEnd, lineEnd),
      )
      if (fragment.trim().length > 0) {
        codeLines.add(line + 1)
      }
    }
  }
  return codeLines.size
}

export async function findTypeScriptFiles(paths: readonly string[]): Promise<readonly string[]> {
  const files: string[] = []

  async function visit(path: string): Promise<void> {
    const pathStat = await stat(path)
    if (pathStat.isFile()) {
      if (SOURCE_EXTENSIONS.has(extname(path))) {
        files.push(path)
      }
      return
    }
    if (!pathStat.isDirectory()) {
      return
    }
    const entries = await readdir(path, { withFileTypes: true })
    await Promise.all(
      entries
        .filter((entry) => !entry.isDirectory() || !IGNORED_DIRECTORIES.has(entry.name))
        .map((entry) => visit(join(path, entry.name))),
    )
  }

  await Promise.all(paths.map(visit))
  return files.sort()
}

export async function findOversizedFiles(
  paths: readonly string[],
  maximumLines = 250,
): Promise<readonly FileSizeViolation[]> {
  const files = await findTypeScriptFiles(paths)
  const violations = await Promise.all(
    files.map(async (filePath): Promise<FileSizeViolation | undefined> => {
      const pureLines = countPureLines(await readFile(filePath, "utf8"))
      return pureLines > maximumLines ? { filePath, maximumLines, pureLines } : undefined
    }),
  )
  return violations.filter((violation) => violation !== undefined)
}

class FileSizePolicyError extends Error {
  public constructor(violations: readonly FileSizeViolation[]) {
    super(
      violations
        .map(
          ({ filePath, maximumLines, pureLines }) =>
            `${filePath}: ${pureLines} pure LOC exceeds ${maximumLines}`,
        )
        .join("\n"),
    )
    this.name = "FileSizePolicyError"
  }
}

if (import.meta.main) {
  const paths = process.argv.slice(2)
  const violations = await findOversizedFiles(paths.length > 0 ? paths : ["."])
  if (violations.length > 0) {
    throw new FileSizePolicyError(violations)
  }
}
