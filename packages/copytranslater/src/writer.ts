import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

function interfaceDeclaration(name: string, values: Record<string, string>): ts.InterfaceDeclaration {
  const members = Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ts.factory.createPropertySignature(
      undefined,
      ts.factory.createIdentifier(key),
      undefined,
      ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(value)),
    ));
  return ts.factory.createInterfaceDeclaration(
    [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
    name,
    undefined,
    undefined,
    members,
  );
}

function replaceInterface(source: ts.SourceFile, name: string, values: Record<string, string>): ts.SourceFile {
  const replacement = interfaceDeclaration(name, values);
  const index = source.statements.findIndex((statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === name);
  const statements = [...source.statements];
  if (index >= 0) {
    statements[index] = replacement;
  } else {
    const formatIndex = statements.findIndex((statement) => ts.isTypeAliasDeclaration(statement) && statement.name.text === "CopyTranslaterFormat");
    statements.splice(formatIndex >= 0 ? formatIndex + 1 : 0, 0, replacement);
  }
  return ts.factory.updateSourceFile(source, statements);
}

export function printWithInterfaces(
  fileName: string,
  text: string,
  interfaces: Record<string, Record<string, string>>,
): string {
  let source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const [name, values] of Object.entries(interfaces)) source = replaceInterface(source, name, values);
  return `${printer.printFile(source).trimEnd()}\n`;
}

function parseInitializer(functionText: string): ts.Expression {
  const source = ts.createSourceFile("update.ts", `const value = ${functionText};`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const statement = source.statements[0];
  if (!statement || !ts.isVariableStatement(statement)) throw new Error("Invalid message function");
  const initializer = statement.declarationList.declarations[0]?.initializer;
  const diagnostics = (source as ts.SourceFile & { parseDiagnostics: readonly ts.DiagnosticWithLocation[] }).parseDiagnostics;
  if (!initializer || diagnostics.length) throw new Error("Invalid message function");
  return initializer;
}

function updateInitializer(fileName: string, text: string, id: string, functionText: string): ts.SourceFile {
  parseInitializer(functionText);
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let target: ts.Expression | undefined;
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== id || !declaration.initializer) continue;
      let expression = declaration.initializer;
      while (ts.isParenthesizedExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isAsExpression(expression)) {
        expression = expression.expression;
      }
      target = expression;
    }
  }
  if (!target) throw new Error(`Message ${id} does not exist in ${fileName}`);
  const updatedText = `${text.slice(0, target.getStart(source))}${functionText}${text.slice(target.end)}`;
  return ts.createSourceFile(fileName, updatedText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

export function printUpdatedMessage(
  fileName: string,
  text: string,
  id: string,
  functionText: string,
  basedOn: Record<string, string>,
  reviewed: Record<string, string>,
): string {
  let source = updateInitializer(fileName, text, id, functionText);
  source = replaceInterface(source, "BasedOn", basedOn);
  source = replaceInterface(source, "Reviewed", reviewed);
  return `${printer.printFile(source).trimEnd()}\n`;
}

export function printUpdatedSourceMessage(
  fileName: string,
  text: string,
  id: string,
  functionText: string,
  revisions: Record<string, string>,
): string {
  let source = updateInitializer(fileName, text, id, functionText);
  source = replaceInterface(source, "SourceRevisions", revisions);
  return `${printer.printFile(source).trimEnd()}\n`;
}

export function printAddedTranslationMessage(
  fileName: string,
  text: string,
  id: string,
  functionText: string,
  basedOn: Record<string, string>,
  reviewed: Record<string, string>,
): string {
  const addition = `\nexport const ${id} = (${functionText}) satisfies typeof Source.${id};\n`;
  let source = ts.createSourceFile(fileName, `${text.trimEnd()}${addition}`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  source = replaceInterface(source, "BasedOn", basedOn);
  source = replaceInterface(source, "Reviewed", reviewed);
  return `${printer.printFile(source).trimEnd()}\n`;
}

export async function atomicWrite(fileName: string, content: string): Promise<boolean> {
  await mkdir(path.dirname(fileName), { recursive: true });
  let current: string | undefined;
  try { current = await readFile(fileName, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (current === content) return false;
  const temporary = `${fileName}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, "utf8");
  try {
    await rename(temporary, fileName);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return true;
}
