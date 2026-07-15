import { readFile } from "node:fs/promises";
import path from "node:path";
import { analyzeProject } from "./project.js";
import { parseFunctionText, parseModuleText } from "./parser.js";
import type { LocalizedMessage, LocalizationStore, MessageQuery, MessageRef, UpdateMessageInput, UpdateResult } from "./types.js";
import { loadConfig } from "./config.js";
import { assertConfiguredRef, resolveMessageModule } from "./security.js";
import { atomicWrite, printAddedTranslationMessage, printUpdatedMessage, printUpdatedSourceMessage, withWriteLock } from "./writer.js";

function sameRef(left: MessageRef, right: MessageRef): boolean {
  return left.locale === right.locale && left.namespace === right.namespace && left.id === right.id;
}

export class TypeScriptModuleStore implements LocalizationStore {
  readonly id = "typescript-modules";
  readonly capabilities = { read: true, write: true } as const;

  constructor(private readonly root = process.cwd()) {}

  async listMessages(query: MessageQuery = {}): Promise<LocalizedMessage[]> {
    return (await analyzeProject(this.root, query)).messages;
  }

  async getMessage(ref: MessageRef): Promise<LocalizedMessage> {
    const { config } = await loadConfig(this.root);
    assertConfiguredRef(config, ref);
    if (ref.locale === config.sourceLocale) {
      const messagesRoot = path.resolve(this.root, config.messages);
      const fileName = await resolveMessageModule(messagesRoot, config.sourceLocale, ref.namespace);
      const parsed = parseModuleText(fileName, await readFile(fileName, "utf8"));
      const source = parsed.messages.get(ref.id);
      if (!source) throw new Error(`Unknown message ${ref.locale}/${ref.namespace}.${ref.id}`);
      const result: LocalizedMessage = {
        ref,
        state: "current",
        sourceFingerprint: source.semanticFingerprint,
        source,
        target: source,
      };
      const context = parsed.context[ref.id];
      if (context) result.context = context;
      return result;
    }
    const analysis = await analyzeProject(this.root, { locale: ref.locale, namespace: ref.namespace });
    const result = analysis.messages.find((message) => sameRef(message.ref, ref));
    if (!result) {
      const unsafe = analysis.diagnostics.find((diagnostic) => diagnostic.code === "unsafe");
      if (unsafe) throw new Error(unsafe.message);
      throw new Error(`Unknown message ${ref.locale}/${ref.namespace}.${ref.id}`);
    }
    return result;
  }

  async updateMessage(input: UpdateMessageInput): Promise<UpdateResult> {
    const loaded = await loadConfig(this.root);
    assertConfiguredRef(loaded.config, input);
    const messagesRoot = path.resolve(this.root, loaded.config.messages);
    return withWriteLock(path.join(messagesRoot, ".copytranslater-project"), async () => this.updateMessageLocked(input));
  }

  private async updateMessageLocked(input: UpdateMessageInput): Promise<UpdateResult> {
    const analysis = await analyzeProject(this.root, { locale: input.locale, namespace: input.namespace });
    if (input.locale === analysis.config.sourceLocale) return this.updateSourceMessage(input);
    const current = analysis.messages.find((message) => sameRef(message.ref, input));
    if (!current) throw new Error(`Unknown message ${input.namespace}.${input.id}`);
    if (current.sourceFingerprint !== input.expectedSourceFingerprint) throw new Error("Source fingerprint conflict");
    if (input.expectedTargetFingerprint !== undefined && (current.target?.semanticFingerprint ?? null) !== input.expectedTargetFingerprint) {
      throw new Error("Target fingerprint conflict");
    }
    const proposed = parseFunctionText(input.id, input.functionText);
    if (proposed.contractFingerprint !== current.source.contractFingerprint) throw new Error("Updated message has an incompatible contract");
    const fileName = await resolveMessageModule(analysis.messagesRoot, input.locale, input.namespace);
    let before: string;
    let existingBefore: string | undefined;
    try {
      before = await readFile(fileName, "utf8");
      existingBefore = before;
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const helpers = ["plural", "select", "formatNumber", "formatDateTime", "formatList"]
        .filter((helper) => new RegExp(`\\b${helper}\\s*\\(`).test(input.functionText));
      const runtimeImport = helpers.length ? `import { ${helpers.join(", ")} } from "@copytranslater/runtime";\n` : "";
      before = `import type * as Source from "../${analysis.config.sourceLocale}/${input.namespace}.js";\n${runtimeImport}\nexport type CopyTranslaterFormat = 1;\n\nexport interface BasedOn {}\nexport interface Reviewed {}\n`;
    }
    const parsed = parseModuleText(fileName, before);
    const basedOn = { ...parsed.revisions, [input.id]: current.sourceFingerprint };
    const reviewed = { ...parsed.reviewed };
    if (input.review) reviewed[input.id] = current.sourceFingerprint;
    else delete reviewed[input.id];
    const after = current.target
      ? printUpdatedMessage(fileName, before, input.id, input.functionText, basedOn, reviewed)
      : printAddedTranslationMessage(fileName, before, input.id, input.functionText, basedOn, reviewed);
    const changed = await atomicWrite(fileName, after, { expectedContent: existingBefore ?? null });
    return { changed, before, after };
  }

  private async updateSourceMessage(input: UpdateMessageInput): Promise<UpdateResult> {
    const { config } = await loadConfig(this.root);
    assertConfiguredRef(config, input);
    const messagesRoot = path.resolve(this.root, config.messages);
    const fileName = await resolveMessageModule(messagesRoot, config.sourceLocale, input.namespace);
    const before = await readFile(fileName, "utf8");
    const parsed = parseModuleText(fileName, before);
    const current = parsed.messages.get(input.id);
    if (!current) throw new Error(`Unknown source message ${input.namespace}.${input.id}`);
    if (current.semanticFingerprint !== input.expectedSourceFingerprint) throw new Error("Source fingerprint conflict");
    if (input.expectedTargetFingerprint !== undefined && input.expectedTargetFingerprint !== current.semanticFingerprint) {
      throw new Error("Target fingerprint conflict");
    }
    const proposed = parseFunctionText(input.id, input.functionText);
    const revisions = { ...parsed.revisions, [input.id]: proposed.semanticFingerprint };
    const after = printUpdatedSourceMessage(fileName, before, input.id, input.functionText, revisions);
    const changed = await atomicWrite(fileName, after, { expectedContent: before });
    return { changed, before, after };
  }
}
