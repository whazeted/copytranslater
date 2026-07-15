import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
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

const runtimeHelpers = ["plural", "select", "formatNumber", "formatDateTime", "formatList"] as const;

function ensureRuntimeHelpers(source: ts.SourceFile, functionText: string): ts.SourceFile {
  const required = runtimeHelpers.filter((helper) => new RegExp(`\\b${helper}\\s*\\(`).test(functionText));
  if (!required.length) return source;
  const statements = [...source.statements];
  const importIndex = statements.findIndex((statement) => ts.isImportDeclaration(statement) &&
    ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === "@copytranslater/runtime" &&
    !statement.importClause?.isTypeOnly && (!statement.importClause?.namedBindings || ts.isNamedImports(statement.importClause.namedBindings)));
  if (importIndex >= 0) {
    const declaration = statements[importIndex] as ts.ImportDeclaration;
    const clause = declaration.importClause;
    const existing = clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
      ? clause.namedBindings.elements.map((element) => element.name.text)
      : [];
    const names = [...new Set([...existing, ...required])].sort();
    const bindings = ts.factory.createNamedImports(names.map((name) => ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier(name))));
    const updatedClause = ts.factory.createImportClause(false, clause?.name, bindings);
    statements[importIndex] = ts.factory.updateImportDeclaration(declaration, declaration.modifiers, updatedClause, declaration.moduleSpecifier, declaration.attributes);
  } else {
    const bindings = ts.factory.createNamedImports(required.sort().map((name) => ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier(name))));
    statements.unshift(ts.factory.createImportDeclaration(
      undefined,
      ts.factory.createImportClause(false, undefined, bindings),
      ts.factory.createStringLiteral("@copytranslater/runtime"),
      undefined,
    ));
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
  const source = ts.createSourceFile("update.ts", `const value = (${functionText});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const statement = source.statements[0];
  if (!statement || !ts.isVariableStatement(statement)) throw new Error("Invalid message function");
  const initializer = statement.declarationList.declarations[0]?.initializer;
  const diagnostics = (source as ts.SourceFile & { parseDiagnostics: readonly ts.DiagnosticWithLocation[] }).parseDiagnostics;
  if (!initializer || diagnostics.length || source.statements.length !== 1 || statement.declarationList.declarations.length !== 1) throw new Error("Invalid message function");
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
  source = ensureRuntimeHelpers(source, functionText);
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
  source = ensureRuntimeHelpers(source, functionText);
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
  parseInitializer(functionText);
  const addition = `\nexport const ${id} = (${functionText}) satisfies typeof Source.${id};\n`;
  let source = ts.createSourceFile(fileName, `${text.trimEnd()}${addition}`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  source = ensureRuntimeHelpers(source, functionText);
  source = replaceInterface(source, "BasedOn", basedOn);
  source = replaceInterface(source, "Reviewed", reviewed);
  return `${printer.printFile(source).trimEnd()}\n`;
}

export interface AtomicWriteOptions {
  /** `null` means the destination must not exist. */
  expectedContent?: string | null;
}

async function acquireLock(lockName: string): Promise<() => Promise<void>> {
  await mkdir(path.dirname(lockName), { recursive: true });
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      const handle = await open(lockName, "wx");
      try {
        await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, "utf8");
      } catch (error) {
        await handle.close();
        await rm(lockName, { force: true });
        throw error;
      }
      return async () => {
        try { await handle.close(); }
        finally { await rm(lockName, { force: true }); }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const lockStat = await stat(lockName).catch(() => undefined);
      if (lockStat && Date.now() - lockStat.mtimeMs > 60_000) {
        await rm(lockName, { force: true });
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for write lock ${lockName}`);
      await delay(25);
    }
  }
}

export async function withWriteLock<T>(lockName: string, action: () => Promise<T>): Promise<T> {
  const release = await acquireLock(lockName);
  try { return await action(); }
  finally { await release(); }
}

export async function atomicWrite(fileName: string, content: string, options: AtomicWriteOptions = {}): Promise<boolean> {
  await mkdir(path.dirname(fileName), { recursive: true });
  const release = await acquireLock(`${fileName}.copytranslater.lock`);
  let temporary: string | undefined;
  try {
    let current: string | undefined;
    const destination = await lstat(fileName).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    });
    if (destination?.isSymbolicLink()) throw new Error("Unsafe symbolic-link write target");
    try { current = await readFile(fileName, "utf8"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if ("expectedContent" in options && (current ?? null) !== options.expectedContent) throw new Error("File content conflict");
    if (current === content) return false;
    temporary = `${fileName}.${process.pid}.${randomUUID()}.tmp`;
    const currentStat = current === undefined ? undefined : await stat(fileName);
    const handle = await open(temporary, "wx", currentStat?.mode ?? 0o666);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, fileName);
    temporary = undefined;
    return true;
  } catch (error) {
    throw error;
  } finally {
    if (temporary) await rm(temporary, { force: true });
    await release();
  }
}
