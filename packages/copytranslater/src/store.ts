import { readFile } from "node:fs/promises";
import path from "node:path";
import { analyzeProject } from "./project.js";
import { parseFunctionText, parseModuleText } from "./parser.js";
import type { LocalizedMessage, LocalizationStore, MessageQuery, MessageRef, UpdateMessageInput, UpdateResult } from "./types.js";
import { atomicWrite, printUpdatedMessage } from "./writer.js";

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
    const result = (await this.listMessages({ locale: ref.locale, namespace: ref.namespace })).find((message) => sameRef(message.ref, ref));
    if (!result) throw new Error(`Unknown message ${ref.locale}/${ref.namespace}.${ref.id}`);
    return result;
  }

  async updateMessage(input: UpdateMessageInput): Promise<UpdateResult> {
    const analysis = await analyzeProject(this.root, { locale: input.locale, namespace: input.namespace });
    if (input.locale === analysis.config.sourceLocale) throw new Error("Source updates are not supported by this target-message operation");
    const current = analysis.messages.find((message) => sameRef(message.ref, input));
    if (!current?.target) throw new Error("Milestone 0 updates require an existing target export");
    if (current.sourceFingerprint !== input.expectedSourceFingerprint) throw new Error("Source fingerprint conflict");
    const proposed = parseFunctionText(input.id, input.functionText);
    if (proposed.contractFingerprint !== current.source.contractFingerprint) throw new Error("Updated message has an incompatible contract");
    const fileName = path.resolve(analysis.messagesRoot, input.locale, `${input.namespace}.ts`);
    if (!fileName.startsWith(`${path.resolve(analysis.messagesRoot)}${path.sep}`)) throw new Error("Unsafe write target");
    const before = await readFile(fileName, "utf8");
    const parsed = parseModuleText(fileName, before);
    const basedOn = { ...parsed.revisions, [input.id]: current.sourceFingerprint };
    const reviewed = { ...parsed.reviewed };
    if (input.review) reviewed[input.id] = current.sourceFingerprint;
    else delete reviewed[input.id];
    const after = printUpdatedMessage(fileName, before, input.id, input.functionText, basedOn, reviewed);
    const changed = await atomicWrite(fileName, after);
    return { changed, before, after };
  }
}
