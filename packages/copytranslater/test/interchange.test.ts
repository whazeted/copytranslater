import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  TypeScriptModuleStore,
  exportIcu,
  exportJson,
  icuToFunction,
  importIcu,
  importJson,
  initializeProject,
  messageToIcu,
  parseFunctionText,
  syncProject,
} from "../src/index.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

async function fixture(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "copytranslater-interchange-"));
  directories.push(directory);
  await initializeProject(directory);
  await syncProject(directory);
  return directory;
}

describe("JSON and ICU interchange", () => {
  it("round-trips deterministic JSON with source and target concurrency tokens", async () => {
    const root = await fixture();
    const document = await exportJson(root);
    const message = document.messages[0]!;
    message.functionText = "({ name }) => `Hoi, ${name}!`";
    message.reviewed = true;
    const first = await importJson(root, document);
    expect(first).toMatchObject({ changed: 1, unchanged: 0 });
    expect((await new TypeScriptModuleStore(root).getMessage(message)).state).toBe("reviewed");
    expect(await importJson(root, await exportJson(root))).toMatchObject({ changed: 0, unchanged: 1 });

    const conflicting = structuredClone(document);
    conflicting.messages[0]!.sourceFingerprint = "sha256:wrong";
    await expect(importJson(root, conflicting)).rejects.toThrow(/Source fingerprint conflict/);
  });

  it("imports and exports flat ICU bundles", async () => {
    const root = await fixture();
    expect(await exportIcu(root, "nl", "common")).toEqual({ greeting: "Hallo, {name}!" });
    expect(await importIcu(root, "nl", "common", { greeting: "Hoi, {name}!" })).toMatchObject({ changed: 1 });
    expect(await exportIcu(root, "nl", "common")).toEqual({ greeting: "Hoi, {name}!" });
  });

  it("converts nested plural ICU and rejects non-portable list formatting", () => {
    const source = parseFunctionText("items", "({ count }: { count: number }) => plural(count, { one: () => 'One item', other: () => `${count} items` })");
    const icu = messageToIcu(source);
    expect(icu).toContain("{count, plural,");
    const imported = parseFunctionText("items", icuToFunction("{count, plural, one {One item} other {{count} items}}", source));
    expect(imported.contractFingerprint).toBe(source.contractFingerprint);

    const price = parseFunctionText("price", "({ amount }: { amount: number }) => `Total: ${formatNumber(amount, { style: 'currency', currency: 'EUR' })}`");
    expect(messageToIcu(price)).toBe("Total: {amount, number, ::currency/EUR}");
    expect(parseFunctionText("price", icuToFunction(messageToIcu(price), price)).contractFingerprint).toBe(price.contractFingerprint);

    const list = parseFunctionText("names", "({ names }: { names: string[] }) => formatList(names)");
    expect(() => messageToIcu(list)).toThrow(/no portable list element/);

    const punctuation = parseFunctionText("punctuation", "() => \"It's {ready} #1\"");
    expect(parseFunctionText("punctuation", icuToFunction(messageToIcu(punctuation), punctuation)).semanticFingerprint)
      .toBe(punctuation.semanticFingerprint);
  });

  it("adds newly introduced runtime helper imports", async () => {
    const root = await fixture();
    const store = new TypeScriptModuleStore(root);
    const message = (await store.listMessages())[0]!;
    await store.updateMessage({
      locale: "en",
      namespace: message.ref.namespace,
      id: message.ref.id,
      functionText: "({ name }: { name: string }) => select(name, { admin: () => 'Administrator', other: () => `Hello, ${name}!` })",
      expectedSourceFingerprint: message.sourceFingerprint,
      expectedTargetFingerprint: message.sourceFingerprint,
    });
    const current = (await store.listMessages())[0]!;
    await store.updateMessage({
      ...current.ref,
      functionText: "({ name }) => select(name, { admin: () => 'Beheerder', other: () => `Hoi, ${name}!` })",
      expectedSourceFingerprint: current.sourceFingerprint,
      expectedTargetFingerprint: current.target!.semanticFingerprint,
    });
    expect(await readFile(path.join(root, "i18n/messages/en/common.ts"), "utf8")).toContain('import { select } from "@copytranslater/runtime"');
    expect(await readFile(path.join(root, "i18n/messages/nl/common.ts"), "utf8")).toContain('import { select } from "@copytranslater/runtime"');
  });
});
