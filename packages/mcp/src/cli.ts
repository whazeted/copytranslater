#!/usr/bin/env node
import path from "node:path";
import { runMcpStdio } from "./index.js";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: copytranslater-mcp [--root <project>] [--write]\n\nStarts a passive read-only stdio MCP server. --write enables guarded single-message mutations.");
  process.exit(0);
}
const rootIndex = args.indexOf("--root");
const rootArgument = rootIndex >= 0 ? args[rootIndex + 1] : undefined;
if (rootIndex >= 0 && !rootArgument) {
  console.error("CopyTranslater MCP: --root requires a project path");
  process.exit(2);
}
const recognized = new Set(["--root", "--write"]);
const unknown = args.find((argument, index) => !(recognized.has(argument) || (index > 0 && args[index - 1] === "--root")));
if (unknown) {
  console.error(`CopyTranslater MCP: unknown option ${unknown}`);
  process.exit(2);
}
const root = rootArgument ? path.resolve(rootArgument) : process.cwd();

runMcpStdio({ root, allowWrite: args.includes("--write") }).catch((error: unknown) => {
  console.error(`CopyTranslater MCP: ${error instanceof Error ? error.message : "Unexpected server failure"}`);
  process.exitCode = 1;
});
