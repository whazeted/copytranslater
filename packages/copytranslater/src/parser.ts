import { createHash } from "node:crypto";
import ts from "typescript";
import type { ParsedMessage, ParsedModule } from "./types.js";

const helpers = new Set(["plural", "select", "formatNumber", "formatDateTime", "formatList"]);
const pluralKeys = new Set(["zero", "one", "two", "few", "many", "other"]);
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true });

function fail(node: ts.Node, message: string): never {
  const source = node.getSourceFile();
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  throw new Error(`${source.fileName}:${position.line + 1}:${position.character + 1} ${message}`);
}

function nameOf(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return fail(name, "Computed property names are not supported");
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) expression = expression.expression;
  return expression;
}

function returnExpression(functionNode: ts.ArrowFunction | ts.FunctionExpression): ts.Expression {
  if (!ts.isBlock(functionNode.body)) return functionNode.body;
  const statement = functionNode.body.statements[0];
  if (functionNode.body.statements.length !== 1 || !statement || !ts.isReturnStatement(statement) || !statement.expression) {
    return fail(functionNode.body, "Message blocks may only contain one return statement");
  }
  return statement.expression;
}

interface Scope {
  variables: Set<string>;
}

function canonicalExpression(input: ts.Expression, scope: Scope, contract: boolean): unknown {
  const expression = unwrapExpression(input);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return contract ? ["text"] : ["text", expression.text];
  }
  if (ts.isNumericLiteral(expression)) return ["number", Number(expression.text)];
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return ["boolean", true];
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return ["boolean", false];
  if (expression.kind === ts.SyntaxKind.NullKeyword) return ["null"];
  if (ts.isIdentifier(expression)) {
    if (!scope.variables.has(expression.text)) return fail(expression, `Unknown identifier ${expression.text}`);
    return ["variable", expression.text];
  }
  if (ts.isTemplateExpression(expression)) {
    return [
      "template",
      contract ? "" : expression.head.text,
      ...expression.templateSpans.map((span) => [
        canonicalExpression(span.expression, scope, contract),
        contract ? "" : span.literal.text,
      ]),
    ];
  }
  if (ts.isObjectLiteralExpression(expression)) {
    const properties = expression.properties.map((property) => {
      if (!ts.isPropertyAssignment(property)) return fail(property, "Only object property assignments are supported");
      return [nameOf(property.name), canonicalExpression(property.initializer, scope, contract)];
    });
    properties.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return ["object", ...properties];
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return ["array", ...expression.elements.map((item) => {
      if (ts.isSpreadElement(item)) return fail(item, "Spread elements are not supported");
      return canonicalExpression(item, scope, contract);
    })];
  }
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    if (expression.parameters.length !== 0) return fail(expression, "Nested message callbacks cannot declare parameters");
    return ["callback", canonicalExpression(returnExpression(expression), scope, contract)];
  }
  if (ts.isCallExpression(expression)) {
    if (!ts.isIdentifier(expression.expression) || !helpers.has(expression.expression.text)) {
      return fail(expression, "Only CopyTranslater helper calls are supported");
    }
    if (expression.typeArguments?.length) return fail(expression, "Explicit helper type arguments are not supported");
    const helper = expression.expression.text;
    if ((helper === "plural" || helper === "select") && expression.arguments.length !== 2) {
      return fail(expression, `${helper} requires a value and variants object`);
    }
    if (helper.startsWith("format") && (expression.arguments.length < 1 || expression.arguments.length > 2)) {
      return fail(expression, `${helper} requires a value and an optional literal options object`);
    }
    if (helper.startsWith("format") && expression.arguments[1] && !ts.isObjectLiteralExpression(unwrapExpression(expression.arguments[1]))) {
      return fail(expression.arguments[1], `${helper} options must be an object literal`);
    }
    if (helper === "plural") {
      const variants = unwrapExpression(expression.arguments[1]!);
      if (!ts.isObjectLiteralExpression(variants)) return fail(variants, "plural variants must be an object literal");
      const keys = variants.properties.map((property) => {
        if (!ts.isPropertyAssignment(property)) return fail(property, "Plural variants must be property assignments");
        const key = nameOf(property.name);
        if (!pluralKeys.has(key)) return fail(property.name, `Invalid plural category ${key}`);
        return key;
      });
      if (!keys.includes("other")) return fail(variants, "Plural variants require other");
    }
    return ["call", helper, ...expression.arguments.map((argument) => canonicalExpression(argument, scope, contract))];
  }
  return fail(expression, `Unsupported message expression: ${ts.SyntaxKind[expression.kind]}`);
}

function parameters(functionNode: ts.ArrowFunction | ts.FunctionExpression): { scope: Scope; canonical: unknown[] } {
  const variables = new Set<string>();
  const canonical: unknown[] = [];
  for (const parameter of functionNode.parameters) {
    if (parameter.dotDotDotToken || parameter.initializer || parameter.questionToken) fail(parameter, "Optional, rest, and default parameters are not supported");
    if (ts.isIdentifier(parameter.name)) {
      variables.add(parameter.name.text);
      canonical.push([parameter.name.text, parameter.type ? printer.printNode(ts.EmitHint.Unspecified, parameter.type, parameter.getSourceFile()) : "inferred"]);
      continue;
    }
    if (!ts.isObjectBindingPattern(parameter.name)) fail(parameter.name, "Only identifiers and object parameters are supported");
    const names: string[] = [];
    for (const element of parameter.name.elements) {
      if (element.dotDotDotToken || element.propertyName || element.initializer || !ts.isIdentifier(element.name)) {
        fail(element, "Message object parameters only support shorthand bindings");
      }
      variables.add(element.name.text);
      names.push(element.name.text);
    }
    canonical.push([names.sort(), parameter.type ? printer.printNode(ts.EmitHint.Unspecified, parameter.type, parameter.getSourceFile()) : "inferred"]);
  }
  return { scope: { variables }, canonical };
}

function fingerprint(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function parseMessageFunction(id: string, initializer: ts.Expression): ParsedMessage {
  const expression = unwrapExpression(initializer);
  if (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression)) return fail(expression, `Message ${id} must be a function`);
  const params = parameters(expression);
  const semantic = ["function", params.canonical, canonicalExpression(returnExpression(expression), params.scope, false)];
  const contractParams = params.canonical.map((parameter) => {
    const entry = parameter as [unknown, unknown];
    return [entry[0], "source-contract"];
  });
  const contract = ["function", contractParams, canonicalExpression(returnExpression(expression), params.scope, true)];
  return {
    id,
    functionText: printer.printNode(ts.EmitHint.Expression, expression, expression.getSourceFile()),
    semanticFingerprint: fingerprint(semantic),
    contractFingerprint: fingerprint(contract),
    canonical: semantic,
  };
}

function readStringInterface(source: ts.SourceFile, interfaceName: string): Record<string, string> {
  const declaration = source.statements.find((statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName);
  if (!declaration) return {};
  const result: Record<string, string> = {};
  for (const member of declaration.members) {
    if (!ts.isPropertySignature(member) || !member.type || !ts.isLiteralTypeNode(member.type) || !ts.isStringLiteral(member.type.literal)) {
      fail(member, `${interfaceName} entries must be string literal property signatures`);
    }
    result[nameOf(member.name)] = member.type.literal.text;
  }
  return result;
}

function contextValue(type: ts.TypeNode): string | number | boolean {
  if (!ts.isLiteralTypeNode(type)) return fail(type, "Context values must be literal types");
  if (ts.isStringLiteral(type.literal)) return type.literal.text;
  if (ts.isNumericLiteral(type.literal)) return Number(type.literal.text);
  if (type.literal.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (type.literal.kind === ts.SyntaxKind.FalseKeyword) return false;
  return fail(type, "Unsupported context literal");
}

function readContext(source: ts.SourceFile): ParsedModule["context"] {
  const declaration = source.statements.find((statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === "MessageContext");
  if (!declaration) return {};
  const result: ParsedModule["context"] = {};
  for (const member of declaration.members) {
    if (!ts.isPropertySignature(member) || !member.type || !ts.isTypeLiteralNode(member.type)) fail(member, "MessageContext entries must be type literals");
    const entry: Record<string, string | number | boolean> = {};
    for (const field of member.type.members) {
      if (!ts.isPropertySignature(field) || !field.type) fail(field, "Context fields must be property signatures");
      entry[nameOf(field.name)] = contextValue(field.type);
    }
    result[nameOf(member.name)] = entry;
  }
  return result;
}

export function parseModuleText(fileName: string, text: string): ParsedModule {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const syntax = (source as ts.SourceFile & { parseDiagnostics: readonly ts.DiagnosticWithLocation[] }).parseDiagnostics;
  if (syntax.length) {
    const diagnostic = syntax[0]!;
    throw new Error(`${fileName}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`);
  }
  const format = source.statements.find((statement): statement is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(statement) && statement.name.text === "CopyTranslaterFormat");
  if (format && (!ts.isLiteralTypeNode(format.type) || !ts.isNumericLiteral(format.type.literal) || format.type.literal.text !== "1")) {
    fail(format, "Only CopyTranslaterFormat 1 is supported");
  }
  const messages = new Map<string, ParsedMessage>();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) fail(declaration, "Exported messages require a named initialized declaration");
      if (messages.has(declaration.name.text)) fail(declaration.name, `Duplicate message ${declaration.name.text}`);
      messages.set(declaration.name.text, parseMessageFunction(declaration.name.text, declaration.initializer));
    }
  }
  return {
    fileName,
    messages,
    revisions: { ...readStringInterface(source, "SourceRevisions"), ...readStringInterface(source, "BasedOn") },
    reviewed: readStringInterface(source, "Reviewed"),
    context: readContext(source),
  };
}

export function parseFunctionText(id: string, functionText: string): ParsedMessage {
  const source = ts.createSourceFile("update.ts", `const ${id} = ${functionText};`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = (source.statements[0] as ts.VariableStatement | undefined)?.declarationList.declarations[0];
  if (!declaration?.initializer) throw new Error("Update is not a valid function expression");
  return parseMessageFunction(id, declaration.initializer);
}
