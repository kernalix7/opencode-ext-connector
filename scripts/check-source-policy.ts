import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import * as ts from "typescript"

import { findTypeScriptFiles } from "./check-file-size"

export type SourcePolicyRule =
  | "explicit-any"
  | "type-assertion"
  | "non-null-assertion"
  | "ts-suppression"
  | "enum"
  | "console"
  | "provider-sibling-import"
  | "opencode-beta-import"

export type SourcePolicyViolation = {
  readonly filePath: string
  readonly line: number
  readonly rule: SourcePolicyRule
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/")
}

function isLoggerBoundary(filePath: string): boolean {
  const normalizedPath = normalizePath(filePath)
  return (
    normalizedPath === "src/logging/logger.ts" || normalizedPath.endsWith("/src/logging/logger.ts")
  )
}

function isBetaApiBoundary(filePath: string): boolean {
  const normalizedPath = normalizePath(filePath)
  return (
    normalizedPath === "src/opencode/beta-api.ts" ||
    normalizedPath.endsWith("/src/opencode/beta-api.ts")
  )
}

function importedModule(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
    return node.moduleSpecifier.text
  }
  if (
    ts.isExportDeclaration(node) &&
    node.moduleSpecifier !== undefined &&
    ts.isStringLiteralLike(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier.text
  }
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments.length === 1
  ) {
    const argument = node.arguments.at(0)
    return argument !== undefined && ts.isStringLiteralLike(argument) ? argument.text : undefined
  }
  return undefined
}

function importsSiblingProvider(filePath: string, moduleName: string): boolean {
  const normalizedFilePath = normalizePath(filePath)
  const providerMatch = /(?:^|\/)src\/providers\/([^/]+)\//.exec(normalizedFilePath)
  const providerName = providerMatch?.at(1)
  if (providerName === undefined) {
    return false
  }

  const normalizedTarget = moduleName.startsWith(".")
    ? normalizePath(resolve(dirname(filePath), moduleName))
    : moduleName.replace(/^@\/providers\//, "src/providers/")
  const targetMatch = /(?:^|\/)src\/providers\/([^/]+)(?:\/|$)/.exec(normalizedTarget)
  const targetProviderName = targetMatch?.at(1)
  return targetProviderName !== undefined && targetProviderName !== providerName
}

function isConsoleCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) {
    return false
  }
  const expression = node.expression
  if (ts.isPropertyAccessExpression(expression)) {
    return ts.isIdentifier(expression.expression) && expression.expression.text === "console"
  }
  return (
    ts.isElementAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "console"
  )
}

export function inspectSource(
  filePath: string,
  sourceText: string,
): readonly SourcePolicyViolation[] {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true)
  const violations: SourcePolicyViolation[] = []
  const reportAt = (position: number, rule: SourcePolicyRule): void => {
    violations.push({
      filePath,
      line: sourceFile.getLineAndCharacterOfPosition(position).line + 1,
      rule,
    })
  }

  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      reportAt(node.getStart(sourceFile), "explicit-any")
    }
    if (
      (ts.isAsExpression(node) && node.type.getText(sourceFile) !== "const") ||
      ts.isTypeAssertionExpression(node)
    ) {
      reportAt(node.getStart(sourceFile), "type-assertion")
    }
    if (ts.isNonNullExpression(node)) {
      reportAt(node.getStart(sourceFile), "non-null-assertion")
    }
    if (ts.isEnumDeclaration(node)) {
      reportAt(node.getStart(sourceFile), "enum")
    }
    if (!isLoggerBoundary(filePath) && isConsoleCall(node)) {
      reportAt(node.getStart(sourceFile), "console")
    }

    const moduleName = importedModule(node)
    if (moduleName !== undefined) {
      if (importsSiblingProvider(filePath, moduleName)) {
        reportAt(node.getStart(sourceFile), "provider-sibling-import")
      }
      if (
        !isBetaApiBoundary(filePath) &&
        /^@opencode-ai\/(?:plugin|sdk)\/v2(?:\/|$)/.test(moduleName)
      ) {
        reportAt(node.getStart(sourceFile), "opencode-beta-import")
      }
    }

    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    sourceText,
  )
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      (token === ts.SyntaxKind.SingleLineCommentTrivia ||
        token === ts.SyntaxKind.MultiLineCommentTrivia) &&
      /@ts-(?:ignore|expect-error|nocheck)\b/.test(scanner.getTokenText())
    ) {
      reportAt(scanner.getTokenPos(), "ts-suppression")
    }
  }

  return violations.sort(
    (left, right) => left.line - right.line || left.rule.localeCompare(right.rule),
  )
}

export async function checkSourcePolicy(
  paths: readonly string[],
): Promise<readonly SourcePolicyViolation[]> {
  const files = await findTypeScriptFiles(paths)
  const violations = await Promise.all(
    files.map(async (filePath) => inspectSource(filePath, await readFile(filePath, "utf8"))),
  )
  return violations.flat()
}

class SourcePolicyError extends Error {
  public constructor(violations: readonly SourcePolicyViolation[]) {
    super(violations.map(({ filePath, line, rule }) => `${filePath}:${line} [${rule}]`).join("\n"))
    this.name = "SourcePolicyError"
  }
}

if (import.meta.main) {
  const paths = process.argv.slice(2)
  const violations = await checkSourcePolicy(paths.length > 0 ? paths : ["."])
  if (violations.length > 0) {
    throw new SourcePolicyError(violations)
  }
}
