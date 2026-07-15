import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TypeScriptModuleStore, analyzeProject, atomicWrite, initializeProject, loadConfig, syncProject } from "../src/index.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

async function fixture(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "copytranslater-security-"));
  directories.push(directory);
  await initializeProject(directory);
  await syncProject(directory);
  return directory;
}

describe("write-path security and concurrency", () => {
  it("rejects invalid configured locales and both path separator styles", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "i18n.config.ts"), `export default { sourceLocale: "en", locales: ["en", "../nl"], messages: "./i18n/messages", staleTranslations: "error", missingTranslations: "error" };\n`);
    await expect(loadConfig(root)).rejects.toThrow(/Invalid locale/);
    const clean = await fixture();
    const store = new TypeScriptModuleStore(clean);
    await expect(store.getMessage({ locale: "en", namespace: "../nl/common", id: "greeting" })).rejects.toThrow(/Invalid namespace/);
    await expect(store.getMessage({ locale: "en", namespace: "..\\nl\\common", id: "greeting" })).rejects.toThrow(/Invalid namespace/);
  });

  it("rejects stale target fingerprints", async () => {
    const root = await fixture();
    const store = new TypeScriptModuleStore(root);
    const message = (await store.listMessages())[0]!;
    await expect(store.updateMessage({
      ...message.ref,
      functionText: message.target!.functionText,
      expectedSourceFingerprint: message.sourceFingerprint,
      expectedTargetFingerprint: "sha256:wrong",
    })).rejects.toThrow(/Target fingerprint conflict/);
  });

  it("compares expected file content under a lock and cleans temporary artifacts", async () => {
    const root = await fixture();
    const fileName = path.join(root, "value.txt");
    await atomicWrite(fileName, "one", { expectedContent: null });
    await expect(atomicWrite(fileName, "two", { expectedContent: "stale" })).rejects.toThrow(/File content conflict/);
    expect(await readFile(fileName, "utf8")).toBe("one");
    expect((await readdir(root)).filter((name) => name.includes("copytranslater.lock") || name.endsWith(".tmp"))).toEqual([]);
  });

  it("reports configured locale-directory symlink escapes as unsafe", async () => {
    const root = await fixture();
    const messagesRoot = path.join(root, "i18n/messages");
    const localeDirectory = path.join(messagesRoot, "nl");
    const outside = path.join(root, "outside-locale");
    await mkdir(outside);
    await copyFile(path.join(localeDirectory, "common.ts"), path.join(outside, "common.ts"));
    await rm(localeDirectory, { recursive: true });
    await symlink(outside, localeDirectory, process.platform === "win32" ? "junction" : "dir");
    const analysis = await analyzeProject(root);
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: "unsafe", severity: "error" }));
    await expect(new TypeScriptModuleStore(root).getMessage({ locale: "nl", namespace: "common", id: "greeting" })).rejects.toThrow(/Unsafe configured locale directory/);
  });

  it("serializes concurrent project writes without losing either message", async () => {
    const root = await fixture();
    const sourcePath = path.join(root, "i18n/messages/en/common.ts");
    const targetPath = path.join(root, "i18n/messages/nl/common.ts");
    await writeFile(sourcePath, `${await readFile(sourcePath, "utf8")}\nexport const farewell = () => "Goodbye";\n`);
    await writeFile(targetPath, `${await readFile(targetPath, "utf8")}\nexport const farewell = (() => "Tot ziens") satisfies typeof Source.farewell;\n`);
    await syncProject(root);
    const leftStore = new TypeScriptModuleStore(root);
    const rightStore = new TypeScriptModuleStore(root);
    const messages = await leftStore.listMessages();
    const greeting = messages.find((message) => message.ref.id === "greeting")!;
    const farewell = messages.find((message) => message.ref.id === "farewell")!;
    await Promise.all([
      leftStore.updateMessage({ ...greeting.ref, functionText: "({ name }) => `Hoi, ${name}!`", expectedSourceFingerprint: greeting.sourceFingerprint, expectedTargetFingerprint: greeting.target!.semanticFingerprint }),
      rightStore.updateMessage({ ...farewell.ref, functionText: "() => 'Dag'", expectedSourceFingerprint: farewell.sourceFingerprint, expectedTargetFingerprint: farewell.target!.semanticFingerprint }),
    ]);
    const after = await leftStore.listMessages();
    expect(after.find((message) => message.ref.id === "greeting")?.target?.functionText).toContain("Hoi");
    expect(after.find((message) => message.ref.id === "farewell")?.target?.functionText).toContain("Dag");
  });
});
