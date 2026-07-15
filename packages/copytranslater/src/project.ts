import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { isEmptyMessage, parseModuleText } from "./parser.js";
import { resolveMessageModule } from "./security.js";
import type { Diagnostic, I18nConfig, LocalizedMessage, MessageQuery } from "./types.js";
import { atomicWrite, printWithInterfaces, withWriteLock } from "./writer.js";

export interface ProjectAnalysis {
  root: string;
  config: I18nConfig;
  messagesRoot: string;
  messages: LocalizedMessage[];
  diagnostics: Diagnostic[];
}

async function exists(fileName: string): Promise<boolean> {
  try { await readFile(fileName); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function analyzeProject(root = process.cwd(), query: MessageQuery = {}): Promise<ProjectAnalysis> {
  const loaded = await loadConfig(root);
  const config = loaded.config;
  const messagesRoot = path.resolve(root, config.messages);
  const sourceDirectory = path.join(messagesRoot, config.sourceLocale);
  const sourceFiles = (await readdir(sourceDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name)
    .sort();
  const messages: LocalizedMessage[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const sourceFile of sourceFiles) {
    const namespace = sourceFile.slice(0, -3);
    if (query.namespace && query.namespace !== namespace) continue;
    let sourcePath: string;
    try { sourcePath = await resolveMessageModule(messagesRoot, config.sourceLocale, namespace); }
    catch (error) {
      diagnostics.push({ code: "unsafe", severity: "error", message: error instanceof Error ? error.message : "Unsafe source module" });
      continue;
    }
    let source;
    try { source = parseModuleText(sourcePath, await readFile(sourcePath, "utf8")); }
    catch (error) {
      diagnostics.push({ code: "invalid", severity: "error", message: (error as Error).message });
      continue;
    }
    for (const sourceMessage of source.messages.values()) {
      if (isEmptyMessage(sourceMessage)) {
        diagnostics.push({ code: "empty", severity: "error", message: `${namespace}.${sourceMessage.id} source is empty`, ref: { locale: config.sourceLocale, namespace, id: sourceMessage.id } });
      }
      if (source.revisions[sourceMessage.id] !== sourceMessage.semanticFingerprint) {
        diagnostics.push({
          code: "unsynchronized",
          severity: "error",
          message: `${namespace}.${sourceMessage.id} has an unsynchronized source fingerprint`,
          ref: { locale: config.sourceLocale, namespace, id: sourceMessage.id },
        });
      }
    }

    for (const locale of config.locales) {
      if (locale === config.sourceLocale || (query.locale && query.locale !== locale)) continue;
      let targetPath: string;
      try { targetPath = await resolveMessageModule(messagesRoot, locale, namespace); }
      catch (error) {
        diagnostics.push({ code: "unsafe", severity: "error", message: error instanceof Error ? error.message : "Unsafe target module" });
        continue;
      }
      let target: ReturnType<typeof parseModuleText> | undefined;
      if (await exists(targetPath)) {
        try { target = parseModuleText(targetPath, await readFile(targetPath, "utf8")); }
        catch (error) {
          diagnostics.push({ code: "invalid", severity: "error", message: (error as Error).message });
          continue;
        }
      }
      for (const sourceMessage of source.messages.values()) {
        const ref = { locale, namespace, id: sourceMessage.id };
        const targetMessage = target?.messages.get(sourceMessage.id);
        const basedOn = target?.revisions[sourceMessage.id];
        const reviewed = target?.reviewed[sourceMessage.id];
        let state: LocalizedMessage["state"];
        if (!targetMessage) state = "missing";
        else if (basedOn !== sourceMessage.semanticFingerprint) state = "stale";
        else if (reviewed === basedOn) state = "reviewed";
        else state = "current";
        if (!targetMessage) {
          diagnostics.push({ code: "missing", severity: config.missingTranslations === "warning" ? "warning" : "error", message: `${locale}/${namespace}.${sourceMessage.id} is missing`, ref });
        } else if (targetMessage.contractFingerprint !== sourceMessage.contractFingerprint) {
          diagnostics.push({ code: "invalid", severity: "error", message: `${locale}/${namespace}.${sourceMessage.id} has an incompatible message contract`, ref });
        } else if (state === "stale") {
          diagnostics.push({ code: "stale", severity: config.staleTranslations === "warning" ? "warning" : "error", message: `${locale}/${namespace}.${sourceMessage.id} is stale`, ref });
        }
        if (targetMessage && isEmptyMessage(targetMessage)) {
          diagnostics.push({ code: "empty", severity: "error", message: `${locale}/${namespace}.${sourceMessage.id} is empty`, ref });
        }
        const localized: LocalizedMessage = {
          ref,
          state,
          sourceFingerprint: sourceMessage.semanticFingerprint,
          source: sourceMessage,
        };
        if (basedOn !== undefined) localized.basedOn = basedOn;
        if (reviewed !== undefined) localized.reviewed = reviewed;
        if (targetMessage) localized.target = targetMessage;
        const context = source.context[sourceMessage.id];
        if (context) localized.context = context;
        messages.push(localized);
      }
      for (const orphan of target?.messages.values() ?? []) {
        if (source.messages.has(orphan.id)) continue;
        diagnostics.push({
          code: "orphan",
          severity: "warning",
          message: `${locale}/${namespace}.${orphan.id} has no source message`,
          ref: { locale, namespace, id: orphan.id },
        });
      }
    }
  }
  const filteredMessages = messages.filter((message) => {
    if (query.state && query.state !== message.state) return false;
    if (!query.diagnostic) return true;
    return diagnostics.some((diagnostic) => diagnostic.code === query.diagnostic && diagnostic.ref &&
      diagnostic.ref.locale === message.ref.locale && diagnostic.ref.namespace === message.ref.namespace && diagnostic.ref.id === message.ref.id);
  });
  return { root, config, messagesRoot, messages: filteredMessages, diagnostics };
}

export async function syncProject(root = process.cwd()): Promise<{ changed: string[] }> {
  const { config } = await loadConfig(root);
  const messagesRoot = path.resolve(root, config.messages);
  return withWriteLock(path.join(messagesRoot, ".copytranslater-project"), async () => syncProjectLocked(config, messagesRoot));
}

async function syncProjectLocked(config: I18nConfig, messagesRoot: string): Promise<{ changed: string[] }> {
  const sourceDirectory = path.join(messagesRoot, config.sourceLocale);
  const sourceFiles = (await readdir(sourceDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name)
    .sort();
  const changed: string[] = [];
  for (const sourceFile of sourceFiles) {
    const namespace = sourceFile.slice(0, -3);
    const fileName = await resolveMessageModule(messagesRoot, config.sourceLocale, namespace);
    const text = await readFile(fileName, "utf8");
    const parsed = parseModuleText(fileName, text);
    const revisions = Object.fromEntries([...parsed.messages.values()].map((message) => [message.id, message.semanticFingerprint]));
    if (await atomicWrite(fileName, printWithInterfaces(fileName, text, { SourceRevisions: revisions }), { expectedContent: text })) changed.push(fileName);
  }
  return { changed };
}

export function reportDiagnostics(analysis: ProjectAnalysis): Diagnostic[] {
  return analysis.diagnostics.filter((diagnostic) => {
    if (diagnostic.code === "missing" && analysis.config.missingTranslations === "allow") return false;
    if (diagnostic.code === "stale" && analysis.config.staleTranslations === "allow") return false;
    return true;
  });
}
