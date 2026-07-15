import path from "node:path";
import { analyzeProject, parseFunctionText, TypeScriptModuleStore, type UpdateMessageInput } from "copytranslater";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

export interface CopyTranslaterViteOptions {
  root?: string;
  endpoint?: string;
}

interface BridgeBody {
  action: "update" | "review" | "acknowledge" | "update-source" | "preview-source";
  locale: string;
  namespace: string;
  id: string;
  expectedSourceFingerprint: string;
  functionText?: string;
  review?: boolean;
}

function send(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function sameOrigin(request: IncomingMessage): boolean {
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; }
  catch { return false; }
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw new Error("Expected application/json");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function bridgeBody(value: unknown): BridgeBody {
  if (!value || typeof value !== "object") throw new Error("Invalid request body");
  const body = value as Partial<BridgeBody>;
  if (!body.action || !["update", "review", "acknowledge", "update-source", "preview-source"].includes(body.action)) throw new Error("Invalid action");
  for (const field of ["locale", "namespace", "id", "expectedSourceFingerprint"] as const) {
    if (typeof body[field] !== "string" || !body[field]) throw new Error(`Missing ${field}`);
  }
  if ((body.action === "update" || body.action === "update-source" || body.action === "preview-source") && typeof body.functionText !== "string") {
    throw new Error("Missing functionText");
  }
  return body as BridgeBody;
}

export function copyTranslater(options: CopyTranslaterViteOptions = {}): Plugin {
  const endpoint = options.endpoint ?? "/__copytranslater";
  const projectRoot = path.resolve(options.root ?? process.cwd());
  const store = new TypeScriptModuleStore(projectRoot);
  return {
    name: "copytranslater",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://copytranslater.local");
        if (url.pathname !== endpoint) return next();
        if (!sameOrigin(request)) return send(response, 403, { error: "Cross-origin bridge request rejected" });
        try {
          if (request.method === "GET") {
            const locale = url.searchParams.get("locale");
            const namespace = url.searchParams.get("namespace");
            const id = url.searchParams.get("id");
            if (!locale || !namespace || !id) return send(response, 400, { error: "locale, namespace, and id are required" });
            const message = await store.getMessage({ locale, namespace, id });
            const project = await analyzeProject(projectRoot, { namespace });
            return send(response, 200, {
              ref: message.ref,
              state: message.state,
              sourceFingerprint: message.sourceFingerprint,
              basedOn: message.basedOn,
              reviewed: message.reviewed,
              sourceFunction: message.source.functionText,
              targetFunction: message.target?.functionText,
              context: message.context,
              isSourceLocale: locale === project.config.sourceLocale,
            });
          }
          if (request.method !== "POST") return send(response, 405, { error: "Method not allowed" });
          const body = bridgeBody(await readBody(request));
          if (body.action === "preview-source") {
            const proposed = parseFunctionText(body.id, body.functionText!);
            const analysis = await analyzeProject(projectRoot, { namespace: body.namespace });
            const matching = analysis.messages.filter((message) => message.ref.namespace === body.namespace && message.ref.id === body.id);
            const current = matching[0];
            if (!current || current.sourceFingerprint !== body.expectedSourceFingerprint) throw new Error("Source fingerprint conflict");
            const staleCount = proposed.semanticFingerprint === current.sourceFingerprint
              ? 0
              : matching.filter((message) => message.target && message.basedOn === current.sourceFingerprint).length;
            return send(response, 200, { staleCount, proposedFingerprint: proposed.semanticFingerprint });
          }
          let input: UpdateMessageInput;
          if (body.action === "update-source") {
            const analysis = await analyzeProject(projectRoot, { namespace: body.namespace });
            input = { locale: analysis.config.sourceLocale, namespace: body.namespace, id: body.id, functionText: body.functionText!, expectedSourceFingerprint: body.expectedSourceFingerprint };
          } else {
            const current = await store.getMessage({ locale: body.locale, namespace: body.namespace, id: body.id });
            input = {
              locale: body.locale,
              namespace: body.namespace,
              id: body.id,
              functionText: body.action === "update" ? body.functionText! : current.target?.functionText ?? current.source.functionText,
              expectedSourceFingerprint: body.expectedSourceFingerprint,
              review: body.action === "review" || body.review === true,
            };
          }
          const result = await store.updateMessage(input);
          if (result.changed) server.ws.send({ type: "full-reload", path: "*" });
          return send(response, 200, { changed: result.changed });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown bridge error";
          const status = /conflict/i.test(message) ? 409 : 400;
          return send(response, status, { error: message });
        }
      });
    },
  };
}
