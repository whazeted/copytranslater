import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { initializeProject, syncProject, TypeScriptModuleStore } from "copytranslater";
import { copyTranslater } from "../src/vite.js";

const directories: string[] = [];
const servers: ViteDevServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
describe("Vite development bridge", () => {
  it("reads, previews, and writes through guarded message operations", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "copytranslater-vite-"));
    directories.push(root);
    await initializeProject(root);
    await syncProject(root);
    const store = new TypeScriptModuleStore(root);
    const message = (await store.listMessages())[0]!;
    await store.updateMessage({ ...message.ref, functionText: message.target!.functionText, expectedSourceFingerprint: message.sourceFingerprint });
    const server = await createServer({ configFile: false, root, logLevel: "silent", plugins: [copyTranslater({ root })], server: { host: "127.0.0.1", port: 0 } });
    servers.push(server);
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("Vite did not expose a TCP address");
    const origin = `http://127.0.0.1:${address.port}`;
    const query = "locale=nl&namespace=common&id=greeting";
    const read = await fetch(`${origin}/__copytranslater?${query}`);
    expect(read.status).toBe(200);
    const details = await read.json() as { sourceFingerprint: string; targetFunction: string };
    const preview = await fetch(`${origin}/__copytranslater`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "preview-source", locale: "nl", namespace: "common", id: "greeting", expectedSourceFingerprint: details.sourceFingerprint, functionText: "({ name }: { name: string }) => `Welcome, ${name}!`" }),
    });
    expect(await preview.json()).toMatchObject({ staleCount: 1 });
    const update = await fetch(`${origin}/__copytranslater`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "update", locale: "nl", namespace: "common", id: "greeting", expectedSourceFingerprint: details.sourceFingerprint, functionText: "({ name }) => `Welkom, ${name}!`", review: true }),
    });
    expect(update.status).toBe(200);
    expect((await store.getMessage(message.ref)).state).toBe("reviewed");
    const rejected = await fetch(`${origin}/__copytranslater?${query}`, { headers: { origin: "https://attacker.test" } });
    expect(rejected.status).toBe(403);
  });
});
