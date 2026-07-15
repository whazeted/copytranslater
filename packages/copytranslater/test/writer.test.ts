import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { atomicWrite, printWithInterfaces } from "../src/writer.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("deterministic writes", () => {
  it("sorts revisions and avoids byte-identical rewrites", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "copytranslater-writer-"));
    directories.push(directory);
    const fileName = path.join(directory, "common.ts");
    const source = "export type CopyTranslaterFormat = 1;\nexport const hello = () => 'Hello';\n";
    const generated = printWithInterfaces(fileName, source, { SourceRevisions: { zed: "sha256:z", alpha: "sha256:a" } });
    expect(generated.indexOf("alpha")).toBeLessThan(generated.indexOf("zed"));
    expect(await atomicWrite(fileName, generated)).toBe(true);
    const before = await stat(fileName);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await atomicWrite(fileName, generated)).toBe(false);
    const after = await stat(fileName);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(await readFile(fileName, "utf8")).toBe(generated);
  });
});
