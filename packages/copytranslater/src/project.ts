import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { parseModuleText } from "./parser.js";
import type { Diagnostic, I18nConfig, LocalizedMessage, MessageQuery } from "./types.js";
import { atomicWrite, printWithInterfaces } from "./writer.js";

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
    const sourcePath = path.join(sourceDirectory, sourceFile);
    let source;
    try { source = parseModuleText(sourcePath, await readFile(sourcePath, "utf8")); }
    catch (error) {
      diagnostics.push({ code: "invalid", severity: "error", message: (error as Error).message });
      continue;
    }
    for (const sourceMessage of source.messages.values()) {
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
      const targetPath = path.join(messagesRoot, locale, sourceFile);
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
        if (!query.state || query.state === state) messages.push(localized);
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
  return { root, config, messagesRoot, messages, diagnostics };
}

export async function syncProject(root = process.cwd()): Promise<{ changed: string[] }> {
  const { config } = await loadConfig(root);
  const messagesRoot = path.resolve(root, config.messages);
  const sourceDirectory = path.join(messagesRoot, config.sourceLocale);
  const sourceFiles = (await readdir(sourceDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name)
    .sort();
  const changed: string[] = [];
  for (const sourceFile of sourceFiles) {
    const fileName = path.join(sourceDirectory, sourceFile);
    const text = await readFile(fileName, "utf8");
    const parsed = parseModuleText(fileName, text);
    const revisions = Object.fromEntries([...parsed.messages.values()].map((message) => [message.id, message.semanticFingerprint]));
    if (await atomicWrite(fileName, printWithInterfaces(fileName, text, { SourceRevisions: revisions }))) changed.push(fileName);
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
