import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { CopyTranslaterMcpService, type DiagnosticCode } from "./service.js";

export { CopyTranslaterMcpService } from "./service.js";
export type { DiagnosticCode, MutationInput, SearchMessagesInput, UpdateToolInput, ValidationInput } from "./service.js";

export interface CopyTranslaterMcpOptions {
  root?: string;
  allowWrite?: boolean;
}

const states = ["missing", "stale", "current", "reviewed"] as const;
const diagnosticCodes = ["invalid", "unsynchronized", "missing", "empty", "stale", "orphan", "unsafe"] as const satisfies readonly DiagnosticCode[];
const stateSchema = z.enum(states);
const diagnosticSchema = z.enum(diagnosticCodes);
const refShape = {
  locale: z.string().min(1).max(100).describe("Configured locale, for example nl or pt-BR"),
  namespace: z.string().min(1).max(200).describe("Configured flat message namespace, for example checkout"),
  id: z.string().min(1).max(200).describe("Exported message identifier"),
};
const queryShape = {
  locale: z.string().min(1).max(100).optional(),
  namespace: z.string().min(1).max(200).optional(),
  state: stateSchema.optional(),
  diagnostic: diagnosticSchema.optional(),
};
const mutationShape = {
  ...refShape,
  expected_source_fingerprint: z.string().startsWith("sha256:").describe("Source fingerprint returned by get_message"),
  expected_target_fingerprint: z.string().startsWith("sha256:").nullable().describe("Target fingerprint returned by get_message; use null when missing"),
};
const outputSchema = z.object({ ok: z.literal(true), result: z.record(z.string(), z.unknown()) });

function success(result: Record<string, unknown>): CallToolResult {
  const structuredContent = { ok: true as const, result };
  return { content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }], structuredContent };
}

function failure(error: unknown, root: string): CallToolResult {
  const raw = error instanceof Error ? error.message : "Unexpected MCP tool failure";
  const message = raw.split(root).join("<project>");
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }, null, 2) }] };
}

function handler<T>(service: CopyTranslaterMcpService, action: (input: T) => Promise<Record<string, unknown>>): (input: T) => Promise<CallToolResult> {
  return async (input: T): Promise<CallToolResult> => {
    try { return success(await action(input)); }
    catch (error) { return failure(error, service.root); }
  };
}

const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function createCopyTranslaterMcpServer(options: CopyTranslaterMcpOptions = {}): McpServer {
  const service = new CopyTranslaterMcpService(options.root ?? process.cwd(), options.allowWrite ?? false);
  const server = new McpServer(
    { name: "copytranslater-mcp-server", version: "0.1.0" },
    { instructions: "This is a passive local project server. Read get_project capabilities first. Mutations are single-message only, require both source and target fingerprints, and never start background work." },
  );

  server.registerTool("get_project", {
    title: "Get CopyTranslater Project",
    description: "Return configured locales, policies, stores, and effective MCP read/write capabilities. Call this first. Takes no arguments.",
    inputSchema: z.object({}).strict(),
    outputSchema,
    annotations: readAnnotations,
  }, handler(service, async () => service.getProject()));

  const searchSchema = z.object({
    ...queryShape,
    text: z.string().max(500).optional().describe("Case-insensitive text matched against IDs, functions, and context"),
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).default(0),
  }).strict();
  server.registerTool("search_messages", {
    title: "Search CopyTranslater Messages",
    description: "Search target messages by text, locale, namespace, workflow state, or diagnostic. Returns a paginated summary with fingerprints for follow-up reads.",
    inputSchema: searchSchema,
    outputSchema,
    annotations: readAnnotations,
  }, handler(service, async (input: z.infer<typeof searchSchema>) => service.searchMessages({
    limit: input.limit,
    offset: input.offset,
    ...(input.text ? { text: input.text } : {}),
    ...(input.locale ? { locale: input.locale } : {}),
    ...(input.namespace ? { namespace: input.namespace } : {}),
    ...(input.state ? { state: input.state } : {}),
    ...(input.diagnostic ? { diagnostic: input.diagnostic } : {}),
  })));

  const getSchema = z.object(refShape).strict();
  server.registerTool("get_message", {
    title: "Get CopyTranslater Message",
    description: "Read one source or target message, its context, revisions, validation diagnostics, and recoverable stale-source change when Git history contains it.",
    inputSchema: getSchema,
    outputSchema,
    annotations: readAnnotations,
  }, handler(service, async (input: z.infer<typeof getSchema>) => service.getMessage(input)));

  const updateSchema = z.object({
    ...mutationShape,
    function_text: z.string().min(1).max(200_000).optional().describe("Complete bounded TypeScript message function"),
    review: z.boolean().default(false).describe("Mark the resulting current translation reviewed"),
    acknowledge_source: z.boolean().default(false).describe("Advance BasedOn while retaining the current target function"),
  }).strict();
  server.registerTool("update_message", {
    title: "Update One CopyTranslater Message",
    description: "Atomically update exactly one configured source or target message. Requires source and target fingerprints. Provide function_text, or acknowledge_source=true for an existing stale target. Returns a structured before/after diff.",
    inputSchema: updateSchema,
    outputSchema,
    annotations: writeAnnotations,
  }, handler(service, async (input: z.infer<typeof updateSchema>) => service.updateMessage({
    locale: input.locale,
    namespace: input.namespace,
    id: input.id,
    expectedSourceFingerprint: input.expected_source_fingerprint,
    expectedTargetFingerprint: input.expected_target_fingerprint,
    ...(input.function_text !== undefined ? { functionText: input.function_text } : {}),
    review: input.review,
    acknowledgeSource: input.acknowledge_source,
  })));

  const reviewSchema = z.object(mutationShape).strict();
  server.registerTool("review_message", {
    title: "Review One CopyTranslater Message",
    description: "Mark one existing current translation reviewed. Stale and missing translations are rejected. Requires source and target fingerprints and returns a structured before/after diff.",
    inputSchema: reviewSchema,
    outputSchema,
    annotations: writeAnnotations,
  }, handler(service, async (input: z.infer<typeof reviewSchema>) => service.reviewMessage({
    locale: input.locale,
    namespace: input.namespace,
    id: input.id,
    expectedSourceFingerprint: input.expected_source_fingerprint,
    expectedTargetFingerprint: input.expected_target_fingerprint,
  })));

  const validateSchema = z.object({
    ...queryShape,
    id: z.string().min(1).max(200).optional(),
    function_text: z.string().max(200_000).optional().describe("Optional proposed function to validate without saving"),
  }).strict();
  server.registerTool("validate", {
    title: "Validate CopyTranslater Messages",
    description: "Validate the project, a filtered set, one existing message, or a proposed function. A one-message request needs locale, namespace, and id. Never writes.",
    inputSchema: validateSchema,
    outputSchema,
    annotations: readAnnotations,
  }, handler(service, async (input: z.infer<typeof validateSchema>) => service.validate({
    ...(input.locale ? { locale: input.locale } : {}),
    ...(input.namespace ? { namespace: input.namespace } : {}),
    ...(input.state ? { state: input.state } : {}),
    ...(input.diagnostic ? { diagnostic: input.diagnostic } : {}),
    ...(input.id ? { id: input.id } : {}),
    ...(input.function_text !== undefined ? { functionText: input.function_text } : {}),
  })));

  const reportSchema = z.object(queryShape).strict();
  server.registerTool("get_report", {
    title: "Get CopyTranslater Coverage Report",
    description: "Return coverage, workflow-state counts, locale summaries, and diagnostic totals for the project or a filtered message set.",
    inputSchema: reportSchema,
    outputSchema,
    annotations: readAnnotations,
  }, handler(service, async (input: z.infer<typeof reportSchema>) => service.getReport({
    ...(input.locale ? { locale: input.locale } : {}),
    ...(input.namespace ? { namespace: input.namespace } : {}),
    ...(input.state ? { state: input.state } : {}),
    ...(input.diagnostic ? { diagnostic: input.diagnostic } : {}),
  })));

  return server;
}

export async function runMcpStdio(options: CopyTranslaterMcpOptions = {}): Promise<void> {
  const server = createCopyTranslaterMcpServer(options);
  await server.connect(new StdioServerTransport());
}
