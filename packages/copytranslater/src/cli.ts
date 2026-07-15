#!/usr/bin/env node
import path from "node:path";
import { initializeProject } from "./init.js";
import { analyzeProject, reportDiagnostics, syncProject } from "./project.js";
import type { MessageQuery, WorkflowState } from "./types.js";

const args = process.argv.slice(2);
const command = args.shift();

function option(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function usage(): never {
  console.error("Usage: i18n <init|sync|check|status> [--locale <locale>] [--namespace <namespace>] [--state <state>] [--format human|json|ci|markdown]");
  process.exit(2);
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
  if (command !== "check" && command !== "status") usage();
  const state = option("--state") as WorkflowState | undefined;
  if (state && !["missing", "stale", "current", "reviewed"].includes(state)) usage();
  const query: MessageQuery = {};
  const locale = option("--locale");
  const namespace = option("--namespace");
  if (locale) query.locale = locale;
  if (namespace) query.namespace = namespace;
  if (state) query.state = state;
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
