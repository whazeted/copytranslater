import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { TypeScriptModuleStore, initializeProject, syncProject } from "copytranslater";
import { createCopyTranslaterMcpServer } from "../src/index.js";

const directories: string[] = [];
const closeables: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(closeables.splice(0).map((item) => item.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "copytranslater-mcp-"));
  directories.push(root);
  await initializeProject(root);
  await syncProject(root);
  return root;
}

async function connect(root: string, allowWrite: boolean): Promise<Client> {
  const server = createCopyTranslaterMcpServer({ root, allowWrite });
  const client = new Client({ name: "copytranslater-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closeables.push(client, server);
  return client;
}

describe("passive MCP server", () => {
  it("registers exactly the seven specified tools with capability annotations", async () => {
    const client = await connect(await fixture(), false);
    const tools = (await client.listTools()).tools;
    expect(tools.map((tool) => tool.name)).toEqual([
      "get_project", "search_messages", "get_message", "update_message", "review_message", "validate", "get_report",
    ]);
    expect(tools.find((tool) => tool.name === "get_project")?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(tools.find((tool) => tool.name === "update_message")?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    const project = await client.callTool({ name: "get_project", arguments: {} });
    expect(project.structuredContent).toMatchObject({ ok: true, result: { capabilities: { passive: true, write: false } } });
  });

  it("enforces read-only mode even when a mutation tool is called", async () => {
    const root = await fixture();
    const message = (await new TypeScriptModuleStore(root).listMessages())[0]!;
    const client = await connect(root, false);
    const result = await client.callTool({ name: "update_message", arguments: {
      locale: message.ref.locale,
      namespace: message.ref.namespace,
      id: message.ref.id,
      expected_source_fingerprint: message.sourceFingerprint,
      expected_target_fingerprint: message.target!.semanticFingerprint,
      function_text: "({ name }) => `Hoi, ${name}!`",
    } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("write capability is disabled");
  });

  it("updates and reviews one message with optimistic concurrency and structured diffs", async () => {
    const root = await fixture();
    const store = new TypeScriptModuleStore(root);
    const before = (await store.listMessages())[0]!;
    const client = await connect(root, true);
    const updated = await client.callTool({ name: "update_message", arguments: {
      locale: before.ref.locale,
      namespace: before.ref.namespace,
      id: before.ref.id,
      expected_source_fingerprint: before.sourceFingerprint,
      expected_target_fingerprint: before.target!.semanticFingerprint,
      function_text: "({ name }) => `Hoi, ${name}!`",
    } });
    expect(updated.structuredContent).toMatchObject({ ok: true, result: { changed: true, diff: { before: { state: "stale" }, after: { state: "current" } } } });
    const current = await store.getMessage(before.ref);
    const reviewed = await client.callTool({ name: "review_message", arguments: {
      locale: current.ref.locale,
      namespace: current.ref.namespace,
      id: current.ref.id,
      expected_source_fingerprint: current.sourceFingerprint,
      expected_target_fingerprint: current.target!.semanticFingerprint,
    } });
    expect(reviewed.structuredContent).toMatchObject({ ok: true, result: { diff: { after: { state: "reviewed" } } } });

    const conflict = await client.callTool({ name: "update_message", arguments: {
      locale: current.ref.locale,
      namespace: current.ref.namespace,
      id: current.ref.id,
      expected_source_fingerprint: current.sourceFingerprint,
      expected_target_fingerprint: before.target!.semanticFingerprint,
      function_text: "({ name }) => `Dag, ${name}!`",
    } });
    expect(conflict.isError).toBe(true);
    expect(JSON.stringify(conflict.content)).toContain("Target fingerprint conflict");
  });

  it("supports search, message detail, validation, and reporting", async () => {
    const root = await fixture();
    const client = await connect(root, false);
    const search = await client.callTool({ name: "search_messages", arguments: { text: "greeting", limit: 1, offset: 0 } });
    expect(search.structuredContent).toMatchObject({ ok: true, result: { total: 1, count: 1, hasMore: false } });
    const details = await client.callTool({ name: "get_message", arguments: { locale: "nl", namespace: "common", id: "greeting" } });
    expect(details.structuredContent).toMatchObject({ ok: true, result: { state: "stale", sourceChange: { recoverable: false } } });
    const validation = await client.callTool({ name: "validate", arguments: {
      locale: "nl", namespace: "common", id: "greeting", function_text: "({ name }) => ''",
    } });
    expect(validation.structuredContent).toMatchObject({ ok: true, result: { valid: false, errors: 3 } });
    const report = await client.callTool({ name: "get_report", arguments: { locale: "nl" } });
    expect(report.structuredContent).toMatchObject({ ok: true, result: { total: 1, states: { stale: 1 } } });
  });
});
