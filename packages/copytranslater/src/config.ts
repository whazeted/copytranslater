import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type { I18nConfig, Policy } from "./types.js";

export function defineI18n<const T extends I18nConfig>(config: T): T {
  return config;
}

function unwrap(expression: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    expression = expression.expression;
  }
  return expression;
}

function literal(expression: ts.Expression): string | boolean | number | undefined {
  expression = unwrap(expression);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

export async function loadConfig(root = process.cwd()): Promise<{ config: I18nConfig; fileName: string }> {
  const fileName = path.join(root, "i18n.config.ts");
  const source = ts.createSourceFile(fileName, await readFile(fileName, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const exported = source.statements.find(ts.isExportAssignment);
  if (!exported) throw new Error("i18n.config.ts must have an export default");
  let expression = unwrap(exported.expression);
  if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === "defineI18n") {
    const argument = expression.arguments[0];
    if (!argument) throw new Error("defineI18n requires a configuration object");
    expression = unwrap(argument);
  }
  if (!ts.isObjectLiteralExpression(expression)) throw new Error("The default export must be a literal configuration object");

  const values = new Map<string, ts.Expression>();
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
      throw new Error("Configuration only supports named property assignments");
    }
    values.set(property.name.text, property.initializer);
  }
  const readString = (name: string, fallback?: string): string => {
    const value = values.get(name);
    if (!value) {
      if (fallback !== undefined) return fallback;
      throw new Error(`Missing configuration property ${name}`);
    }
    const parsed = literal(value);
    if (typeof parsed !== "string") throw new Error(`${name} must be a string literal`);
    return parsed;
  };
  const localesExpression = values.get("locales");
  const localesArray = localesExpression ? unwrap(localesExpression) : undefined;
  if (!localesArray || !ts.isArrayLiteralExpression(localesArray)) {
    throw new Error("locales must be an array of string literals");
  }
  const locales = localesArray.elements.map((item) => {
    const value = literal(item);
    if (typeof value !== "string") throw new Error("locales must contain only string literals");
    return value;
  });
  const sourceLocale = readString("sourceLocale");
  if (!locales.includes(sourceLocale)) throw new Error("locales must include sourceLocale");
  if (new Set(locales).size !== locales.length) throw new Error("locales contains duplicates");
  const policy = (name: string): Policy => {
    const value = readString(name, "error");
    if (value !== "error" && value !== "warning" && value !== "allow") throw new Error(`${name} has an invalid policy`);
    return value;
  };
  return {
    fileName,
    config: {
      sourceLocale,
      locales,
      messages: readString("messages", "./i18n/messages"),
      staleTranslations: policy("staleTranslations"),
      missingTranslations: policy("missingTranslations"),
    },
  };
}
