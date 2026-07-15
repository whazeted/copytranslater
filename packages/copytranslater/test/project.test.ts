import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeProject } from "../src/init.js";
import { analyzeProject, reportDiagnostics, syncProject } from "../src/project.js";
import { TypeScriptModuleStore } from "../src/store.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

async function fixture(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "copytranslater-project-"));
  directories.push(directory);
  await initializeProject(directory);
  await syncProject(directory);
  return directory;
}

describe("project workflow", () => {
  it("does not overwrite files on repeated init", async () => {
    const directory = await fixture();
    const configPath = path.join(directory, "i18n.config.ts");
    await writeFile(configPath, "// user configuration\n");
    expect(await initializeProject(directory)).toEqual([]);
    expect(await readFile(configPath, "utf8")).toBe("// user configuration\n");
  });

  it("derives stale and current state and guards updates", async () => {
    const directory = await fixture();
    const before = await analyzeProject(directory);
    expect(before.messages[0]?.state).toBe("stale");
    const message = before.messages[0]!;
    const store = new TypeScriptModuleStore(directory);
    await expect(store.updateMessage({
      ...message.ref,
      functionText: "({ name }) => `Hoi, ${name}!`",
      expectedSourceFingerprint: "sha256:wrong",
    })).rejects.toThrow(/conflict/);
    const result = await store.updateMessage({
      ...message.ref,
      functionText: "({ name }) => `Hoi, ${name}!`",
      expectedSourceFingerprint: message.sourceFingerprint,
      review: true,
    });
    expect(result.changed).toBe(true);
    expect(result.after).not.toBe(result.before);
    expect((await store.getMessage(message.ref)).state).toBe("reviewed");
  });

  it("detects source edits until sync and then marks targets stale", async () => {
    const directory = await fixture();
    const store = new TypeScriptModuleStore(directory);
    const message = (await store.listMessages())[0]!;
    await store.updateMessage({ ...message.ref, functionText: message.target!.functionText, expectedSourceFingerprint: message.sourceFingerprint });
    const sourcePath = path.join(directory, "i18n/messages/en/common.ts");
    const source = await readFile(sourcePath, "utf8");
    await writeFile(sourcePath, source.replace("Hello,", "Welcome,"));
    expect(reportDiagnostics(await analyzeProject(directory)).some((item) => item.code === "unsynchronized")).toBe(true);
    await syncProject(directory);
    expect((await analyzeProject(directory)).messages[0]?.state).toBe("stale");
  });
});
