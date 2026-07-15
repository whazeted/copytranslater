import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { I18nConfig, MessageRef } from "./types.js";

const namespacePattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const identifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function existingRealPath(fileName: string): Promise<string | undefined> {
  try { return await realpath(fileName); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function assertValidLocale(locale: string): void {
  if (!locale || locale.includes("/") || locale.includes("\\") || locale.includes("\0")) {
    throw new Error(`Invalid locale ${JSON.stringify(locale)}`);
  }
  try {
    if (Intl.getCanonicalLocales(locale).length !== 1) throw new Error();
  } catch {
    throw new Error(`Invalid locale ${JSON.stringify(locale)}`);
  }
}

export function assertValidNamespace(namespace: string): void {
  if (!namespacePattern.test(namespace) || namespace === "." || namespace === "..") {
    throw new Error(`Invalid namespace ${JSON.stringify(namespace)}`);
  }
}

export function assertValidMessageId(id: string): void {
  if (!identifierPattern.test(id)) throw new Error(`Invalid message ID ${JSON.stringify(id)}`);
}

export function assertConfiguredRef(config: I18nConfig, ref: MessageRef): void {
  assertValidLocale(ref.locale);
  assertValidNamespace(ref.namespace);
  assertValidMessageId(ref.id);
  if (!config.locales.includes(ref.locale)) throw new Error(`Locale ${ref.locale} is not configured`);
}

/** Resolve one configured module while rejecting traversal and symlink escapes. */
export async function resolveMessageModule(
  messagesRoot: string,
  locale: string,
  namespace: string,
): Promise<string> {
  assertValidLocale(locale);
  assertValidNamespace(namespace);
  const root = path.resolve(messagesRoot);
  const localeDirectory = path.join(root, locale);
  const fileName = path.join(localeDirectory, `${namespace}.ts`);
  if (!isWithin(root, fileName)) throw new Error("Unsafe configured message target");

  const realRoot = await existingRealPath(root);
  const realLocale = await existingRealPath(localeDirectory);
  if (realRoot && realLocale && !isWithin(realRoot, realLocale)) throw new Error("Unsafe configured locale directory");

  const details = await lstat(fileName).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
  if (details?.isSymbolicLink()) throw new Error("Unsafe symbolic-link message target");
  const realFile = details ? await realpath(fileName) : undefined;
  if (realRoot && realFile && !isWithin(realRoot, realFile)) throw new Error("Unsafe configured message target");
  return fileName;
}
