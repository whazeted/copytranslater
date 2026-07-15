import {
  TYPE,
  isDateTimeSkeleton,
  isNumberSkeleton,
  parse as parseIcu,
  type MessageFormatElement,
  type SimpleFormatElement,
  type Skeleton,
} from "@formatjs/icu-messageformat-parser";
import ts from "typescript";
import { analyzeProject } from "./project.js";
import { parseFunctionText } from "./parser.js";
import { TypeScriptModuleStore } from "./store.js";
import type { LocalizedMessage, MessageQuery, ParsedMessage, UpdateMessageInput } from "./types.js";
import { assertValidMessageId, assertValidNamespace } from "./security.js";

export interface JsonInterchangeMessage {
  locale: string;
  namespace: string;
  id: string;
  state: LocalizedMessage["state"];
  sourceFingerprint: string;
  targetFingerprint: string | null;
  functionText: string;
  reviewed: boolean;
  context?: Record<string, string | number | boolean>;
}

export interface JsonInterchangeDocument {
  format: "copytranslater-json";
  version: 1;
  sourceLocale: string;
  messages: JsonInterchangeMessage[];
}

export interface ImportResult {
  changed: number;
  unchanged: number;
  messages: Array<{ locale: string; namespace: string; id: string; changed: boolean }>;
}

type Canonical = readonly unknown[];

function canonical(value: unknown, description: string): Canonical {
  if (!Array.isArray(value) || typeof value[0] !== "string") throw new Error(`Cannot convert ${description}`);
  return value;
}

function escapeIcuLiteral(value: string, inPlural: boolean): string {
  const escaped = value.replace(/'/g, "''").replace(/[{}]/g, "'$&'");
  return inPlural ? escaped.replace(/#/g, "'#'") : escaped;
}

function objectEntries(value: Canonical): Array<[string, Canonical]> {
  if (value[0] !== "object") throw new Error("Expected a literal variants object");
  return value.slice(1).map((entry) => {
    if (!Array.isArray(entry) || typeof entry[0] !== "string") throw new Error("Invalid variants object");
    return [entry[0], canonical(entry[1], `variant ${entry[0]}`)];
  });
}

function canonicalLiteral(value: Canonical): string | number | boolean | null {
  if (value[0] === "text") return String(value[1] ?? "");
  if (value[0] === "number") return Number(value[1]);
  if (value[0] === "boolean") return Boolean(value[1]);
  if (value[0] === "null") return null;
  throw new Error("Formatter options must contain literal values");
}

function formatterIcuType(helper: string, optionsNode: unknown): string {
  if (optionsNode === undefined) return helper === "formatNumber" ? "number" : "date";
  const options = Object.fromEntries(objectEntries(canonical(optionsNode, `${helper} options`)).map(([key, value]) => [key, canonicalLiteral(value)]));
  const keys = Object.keys(options).sort();
  if (helper === "formatNumber") {
    if (keys.length === 1 && options.style === "percent") return "number, percent";
    if (keys.length === 1 && options.maximumFractionDigits === 0) return "number, integer";
    if (options.style === "currency" && typeof options.currency === "string" && keys.every((key) => key === "style" || key === "currency")) {
      return `number, ::currency/${options.currency}`;
    }
  } else if (helper === "formatDateTime") {
    if (keys.length === 1 && typeof options.dateStyle === "string") return `date, ${options.dateStyle}`;
    if (keys.length === 1 && typeof options.timeStyle === "string") return `time, ${options.timeStyle}`;
  }
  throw new Error(`${helper} options cannot be exported losslessly; use JSON interchange for this message`);
}

function canonicalToIcu(value: unknown, inPlural = false): string {
  const node = canonical(value, "message expression");
  switch (node[0]) {
    case "text": return escapeIcuLiteral(String(node[1] ?? ""), inPlural);
    case "variable": return `{${String(node[1])}}`;
    case "template": {
      let result = escapeIcuLiteral(String(node[1] ?? ""), inPlural);
      for (const span of node.slice(2)) {
        if (!Array.isArray(span)) throw new Error("Invalid template span");
        result += canonicalToIcu(span[0], inPlural);
        result += escapeIcuLiteral(String(span[1] ?? ""), inPlural);
      }
      return result;
    }
    case "callback": return canonicalToIcu(node[1], inPlural);
    case "call": {
      const helper = String(node[1]);
      const argument = canonical(node[2], `${helper} value`);
      if (argument[0] !== "variable") throw new Error(`${helper} ICU export requires a direct message parameter`);
      const name = String(argument[1]);
      if (helper === "plural" || helper === "select") {
        const variants = objectEntries(canonical(node[3], `${helper} variants`));
        return `{${name}, ${helper}, ${variants.map(([key, body]) => `${key} {${canonicalToIcu(body, inPlural || helper === "plural")}}`).join(" ")}}`;
      }
      if (helper === "formatList") throw new Error("ICU MessageFormat 1 has no portable list element; use JSON interchange for this message");
      if (helper === "formatNumber" || helper === "formatDateTime") return `{${name}, ${formatterIcuType(helper, node[3])}}`;
      throw new Error(`Unsupported helper ${helper}`);
    }
    default: throw new Error(`Expression ${String(node[0])} is not ICU-compatible`);
  }
}

export function messageToIcu(message: ParsedMessage): string {
  const root = canonical(message.canonical, `message ${message.id}`);
  if (root[0] !== "function") throw new Error(`Message ${message.id} is not a function`);
  return canonicalToIcu(root[2]);
}

function parameterNames(message: ParsedMessage): Set<string> {
  const root = canonical(message.canonical, `message ${message.id}`);
  const result = new Set<string>();
  if (root[0] !== "function" || !Array.isArray(root[1])) return result;
  for (const parameter of root[1]) {
    if (!Array.isArray(parameter)) continue;
    if (Array.isArray(parameter[0])) for (const name of parameter[0]) result.add(String(name));
    else result.add(String(parameter[0]));
  }
  return result;
}

function sourceParameters(functionText: string): string {
  const source = ts.createSourceFile("parameters.ts", `const value = ${functionText};`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const initializer = (source.statements[0] as ts.VariableStatement | undefined)?.declarationList.declarations[0]?.initializer;
  let expression = initializer;
  while (expression && (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression))) expression = expression.expression;
  if (!expression || (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression))) throw new Error("Invalid source message function");
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true });
  return expression.parameters.map((parameter) => printer.printNode(ts.EmitHint.Unspecified, parameter, source)).join(", ");
}

function literalOptions(options: Record<string, unknown>): string {
  const entries = Object.entries(options).filter(([, value]) => value !== undefined);
  if (!entries.length) return "";
  for (const [, value] of entries) {
    if (!(typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null)) {
      throw new Error("ICU skeleton contains options that are not supported literal values");
    }
  }
  return `, ${JSON.stringify(Object.fromEntries(entries))}`;
}

function styleOptions(element: SimpleFormatElement<TYPE.number | TYPE.date | TYPE.time, Skeleton>): string {
  const style = element.style;
  if (style == null || style === "") return "";
  if (typeof style !== "string") {
    if (isNumberSkeleton(style) || isDateTimeSkeleton(style)) return literalOptions(style.parsedOptions as Record<string, unknown>);
    throw new Error("Unsupported ICU skeleton");
  }
  if (element.type === TYPE.number) {
    if (style === "integer") return literalOptions({ maximumFractionDigits: 0 });
    if (style === "percent") return literalOptions({ style: "percent" });
    throw new Error(`Unsupported named ICU number style ${style}`);
  }
  if (["short", "medium", "long", "full"].includes(style)) {
    return literalOptions(element.type === TYPE.date ? { dateStyle: style } : { timeStyle: style });
  }
  throw new Error(`Unsupported named ICU date/time style ${style}`);
}

function escapeTemplate(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function icuElementsToExpression(elements: MessageFormatElement[], variables: Set<string>, pluralVariable?: string): string {
  const parts: Array<{ literal?: string; expression?: string }> = [];
  const variable = (name: string): string => {
    if (!variables.has(name)) throw new Error(`ICU message uses unknown parameter ${name}`);
    return name;
  };
  for (const element of elements) {
    switch (element.type) {
      case TYPE.literal:
        parts.push({ literal: element.value });
        break;
      case TYPE.argument:
        parts.push({ expression: variable(element.value) });
        break;
      case TYPE.number:
        parts.push({ expression: `formatNumber(${variable(element.value)}${styleOptions(element)})` });
        break;
      case TYPE.date:
      case TYPE.time:
        parts.push({ expression: `formatDateTime(${variable(element.value)}${styleOptions(element)})` });
        break;
      case TYPE.select:
      case TYPE.plural: {
        const name = variable(element.value);
        if (element.type === TYPE.plural && (element.offset !== 0 || element.pluralType !== "cardinal")) {
          throw new Error("Plural offsets and selectordinal are not supported by the native grammar");
        }
        const variants = Object.entries(element.options).map(([key, option]) => {
          if (element.type === TYPE.plural && key.startsWith("=")) throw new Error("Exact-number plural selectors are not supported by the native grammar");
          const body = icuElementsToExpression(option.value, variables, element.type === TYPE.plural ? name : pluralVariable);
          return `${JSON.stringify(key)}: () => ${body}`;
        });
        parts.push({ expression: `${element.type === TYPE.plural ? "plural" : "select"}(${name}, { ${variants.join(", ")} })` });
        break;
      }
      case TYPE.pound:
        if (!pluralVariable) throw new Error("ICU pound sign is only valid inside a plural");
        parts.push({ expression: `formatNumber(${pluralVariable})` });
        break;
      case TYPE.tag:
        throw new Error("Rich-text ICU tags are not supported by the native grammar");
    }
  }
  if (!parts.length) return JSON.stringify("");
  if (parts.length === 1) {
    const part = parts[0]!;
    return part.literal !== undefined ? JSON.stringify(part.literal) : part.expression!;
  }
  return `\`${parts.map((part) => part.literal !== undefined ? escapeTemplate(part.literal) : `\${${part.expression}}`).join("")}\``;
}

export function icuToFunction(message: string, source: ParsedMessage): string {
  const variables = parameterNames(source);
  const elements = parseIcu(message, { requiresOtherClause: true, shouldParseSkeletons: true, ignoreTag: false });
  const body = icuElementsToExpression(elements, variables);
  const result = `(${sourceParameters(source.functionText)}) => ${body}`;
  const parsed = parseFunctionText(source.id, result);
  if (parsed.contractFingerprint !== source.contractFingerprint) throw new Error(`ICU message for ${source.id} has an incompatible parameter contract`);
  return parsed.functionText;
}

export async function exportJson(root = process.cwd(), query: MessageQuery = {}): Promise<JsonInterchangeDocument> {
  const analysis = await analyzeProject(root, query);
  const messages = analysis.messages.map((message): JsonInterchangeMessage => {
    const entry: JsonInterchangeMessage = {
      ...message.ref,
      state: message.state,
      sourceFingerprint: message.sourceFingerprint,
      targetFingerprint: message.target?.semanticFingerprint ?? null,
      functionText: message.target?.functionText ?? message.source.functionText,
      reviewed: message.state === "reviewed",
    };
    if (message.context) entry.context = message.context;
    return entry;
  }).sort((left, right) => `${left.locale}/${left.namespace}/${left.id}`.localeCompare(`${right.locale}/${right.namespace}/${right.id}`));
  return { format: "copytranslater-json", version: 1, sourceLocale: analysis.config.sourceLocale, messages };
}

function jsonDocument(value: unknown): JsonInterchangeDocument {
  if (!value || typeof value !== "object") throw new Error("JSON interchange input must be an object");
  const document = value as Partial<JsonInterchangeDocument>;
  if (document.format !== "copytranslater-json" || document.version !== 1 || typeof document.sourceLocale !== "string" || !Array.isArray(document.messages)) {
    throw new Error("Unsupported CopyTranslater JSON interchange document");
  }
  return document as JsonInterchangeDocument;
}

export async function importJson(root: string, value: unknown): Promise<ImportResult> {
  const document = jsonDocument(value);
  const analysis = await analyzeProject(root);
  if (document.sourceLocale !== analysis.config.sourceLocale) throw new Error("JSON interchange source locale does not match the project");
  const store = new TypeScriptModuleStore(root);
  const prepared: UpdateMessageInput[] = [];
  const seen = new Set<string>();
  for (const entry of document.messages) {
    if (!entry || typeof entry.locale !== "string" || typeof entry.namespace !== "string" || typeof entry.id !== "string" ||
      typeof entry.sourceFingerprint !== "string" || !(typeof entry.targetFingerprint === "string" || entry.targetFingerprint === null) ||
      typeof entry.functionText !== "string" || typeof entry.reviewed !== "boolean") throw new Error("Invalid JSON interchange message");
    if (entry.locale === analysis.config.sourceLocale) throw new Error("JSON import only accepts target locales");
    const key = `${entry.locale}\0${entry.namespace}\0${entry.id}`;
    if (seen.has(key)) throw new Error(`Duplicate JSON interchange message ${entry.locale}/${entry.namespace}.${entry.id}`);
    seen.add(key);
    const current = await store.getMessage(entry);
    if (current.sourceFingerprint !== entry.sourceFingerprint) throw new Error(`Source fingerprint conflict for ${entry.locale}/${entry.namespace}.${entry.id}`);
    const proposed = parseFunctionText(entry.id, entry.functionText);
    if (proposed.contractFingerprint !== current.source.contractFingerprint) throw new Error(`Incompatible contract for ${entry.locale}/${entry.namespace}.${entry.id}`);
    prepared.push({
      locale: entry.locale,
      namespace: entry.namespace,
      id: entry.id,
      functionText: proposed.functionText,
      expectedSourceFingerprint: entry.sourceFingerprint,
      expectedTargetFingerprint: entry.targetFingerprint,
      review: entry.reviewed,
    });
  }
  return applyImport(store, prepared);
}

function icuBundle(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ICU input must be a flat JSON object");
  const result: Record<string, string> = {};
  for (const [id, message] of Object.entries(value)) {
    assertValidMessageId(id);
    if (typeof message !== "string") throw new Error(`ICU message ${id} must be a string`);
    result[id] = message;
  }
  return result;
}

export async function exportIcu(root: string, locale: string, namespace: string): Promise<Record<string, string>> {
  assertValidNamespace(namespace);
  const analysis = await analyzeProject(root, { locale, namespace });
  if (locale === analysis.config.sourceLocale) throw new Error("ICU export currently targets translation locales");
  const entries = analysis.messages.map((message) => [message.ref.id, messageToIcu(message.target ?? message.source)] as const);
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

export async function importIcu(root: string, locale: string, namespace: string, value: unknown): Promise<ImportResult> {
  assertValidNamespace(namespace);
  const bundle = icuBundle(value);
  const analysis = await analyzeProject(root, { locale, namespace });
  if (locale === analysis.config.sourceLocale) throw new Error("ICU import only accepts target locales");
  const store = new TypeScriptModuleStore(root);
  const prepared: UpdateMessageInput[] = [];
  for (const [id, icu] of Object.entries(bundle)) {
    const current = await store.getMessage({ locale, namespace, id });
    prepared.push({
      locale,
      namespace,
      id,
      functionText: icuToFunction(icu, current.source),
      expectedSourceFingerprint: current.sourceFingerprint,
      expectedTargetFingerprint: current.target?.semanticFingerprint ?? null,
    });
  }
  return applyImport(store, prepared);
}

async function applyImport(store: TypeScriptModuleStore, inputs: UpdateMessageInput[]): Promise<ImportResult> {
  const messages: ImportResult["messages"] = [];
  let changed = 0;
  for (const input of inputs) {
    const result = await store.updateMessage(input);
    if (result.changed) changed += 1;
    messages.push({ locale: input.locale, namespace: input.namespace, id: input.id, changed: result.changed });
  }
  return { changed, unchanged: inputs.length - changed, messages };
}
