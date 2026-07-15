#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { initializeProject } from "./init.js";
import { exportIcu, exportJson, importIcu, importJson } from "./interchange.js";
import { analyzeProject, reportDiagnostics, syncProject } from "./project.js";
import type { MessageQuery, WorkflowState } from "./types.js";
import { atomicWrite } from "./writer.js";

const args = process.argv.slice(2);
const command = args.shift();

function option(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function usage(): never {
  console.error("Usage: i18n <init|sync|check|status|import|export|mcp> [--locale <locale>] [--namespace <namespace>] [--state <state>] [--format human|json|ci|markdown] [--input <file>] [--output <file>] [--write]");
  process.exit(2);
}

async function readInterchangeInput(): Promise<unknown> {
  const input = option("--input");
  let text: string;
  if (input) text = await readFile(path.resolve(input), "utf8");
  else {
    if (process.stdin.isTTY) throw new Error("Import requires JSON on stdin or --input <file>");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 10_000_000) throw new Error("Import input exceeds 10 MB");
      chunks.push(buffer);
    }
    text = Buffer.concat(chunks).toString("utf8");
  }
  try { return JSON.parse(text) as unknown; }
  catch { throw new Error("Import input is not valid JSON"); }
}

async function writeInterchangeOutput(value: unknown): Promise<void> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const output = option("--output");
  if (output) await atomicWrite(path.resolve(output), text);
  else process.stdout.write(text);
}

function messageQuery(): MessageQuery {
  const state = option("--state") as WorkflowState | undefined;
  if (state && !["missing", "stale", "current", "reviewed"].includes(state)) usage();
  const query: MessageQuery = {};
  const locale = option("--locale");
  const namespace = option("--namespace");
  if (locale) query.locale = locale;
  if (namespace) query.namespace = namespace;
  if (state) query.state = state;
  return query;
}

async function main(): Promise<void> {
  if (command === "init") {
    const files = await initializeProject();
    console.log(files.length ? `Created ${files.length} files.` : "Project is already initialized.");
    return;
  }
  if (command === "sync") {
    const result = await syncProject();
    console.log(result.changed.length ? `Synchronized ${result.changed.length} source module(s).` : "Source revisions are synchronized.");
    return;
  }
  if (command === "mcp") {
    if (args.includes("--help")) {
      console.log("Usage: i18n mcp [--write]\n\nStarts a passive read-only stdio MCP server. --write enables guarded single-message mutations.");
      return;
    }
    const packageName: string = "@copytranslater/mcp";
    const module = await import(packageName) as { runMcpStdio?: (options: { root: string; allowWrite: boolean }) => Promise<void> };
    if (!module.runMcpStdio) throw new Error("Install @copytranslater/mcp to use the MCP server");
    await module.runMcpStdio({ root: process.cwd(), allowWrite: args.includes("--write") });
    return;
  }
  if (command === "export") {
    const format = option("--format");
    if (format === "json") await writeInterchangeOutput(await exportJson(process.cwd(), messageQuery()));
    else if (format === "icu") {
      const locale = option("--locale");
      const namespace = option("--namespace");
      if (!locale || !namespace) throw new Error("ICU export requires --locale and --namespace");
      await writeInterchangeOutput(await exportIcu(process.cwd(), locale, namespace));
    } else usage();
    return;
  }
  if (command === "import") {
    const format = option("--format");
    const input = await readInterchangeInput();
    let result;
    if (format === "json") result = await importJson(process.cwd(), input);
    else if (format === "icu") {
      const locale = option("--locale");
      const namespace = option("--namespace");
      if (!locale || !namespace) throw new Error("ICU import requires --locale and --namespace");
      result = await importIcu(process.cwd(), locale, namespace, input);
    } else usage();
    console.log(`Imported ${result.messages.length} message(s): ${result.changed} changed, ${result.unchanged} unchanged.`);
    return;
  }
  if (command !== "check" && command !== "status") usage();
  const query = messageQuery();
  const analysis = await analyzeProject(process.cwd(), query);
  const diagnostics = reportDiagnostics(analysis);
  const format = option("--format") ?? "human";
  if (format === "json") {
    console.log(JSON.stringify({ messages: analysis.messages, diagnostics }, null, 2));
  } else if (format === "markdown") {
    console.log("| Locale | Namespace | Message | State |\n|---|---|---|---|");
    for (const message of analysis.messages) console.log(`| ${message.ref.locale} | ${message.ref.namespace} | ${message.ref.id} | ${message.state} |`);
  } else if (command === "status") {
    const counts = new Map<string, number>();
    for (const message of analysis.messages) counts.set(message.state, (counts.get(message.state) ?? 0) + 1);
    console.log([...counts.entries()].sort().map(([key, value]) => `${key}: ${value}`).join("\n") || "No target messages.");
  } else {
    for (const diagnostic of diagnostics) {
      if (format === "ci") {
        const level = diagnostic.severity === "error" ? "error" : "warning";
        console.log(`::${level} title=CopyTranslater::${diagnostic.message}`);
      } else console.log(`${diagnostic.severity.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}`);
    }
    if (!diagnostics.length) console.log("CopyTranslater check passed.");
  }
  if (command === "check" && diagnostics.some((diagnostic) => diagnostic.severity === "error")) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`CopyTranslater: ${(error as Error).message}`);
  process.exitCode = 1;
});
