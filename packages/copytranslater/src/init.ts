import path from "node:path";
import { readFile } from "node:fs/promises";
import { atomicWrite } from "./writer.js";

export async function initializeProject(root = process.cwd()): Promise<string[]> {
  const files: Record<string, string> = {
    "i18n.config.ts": `import { defineI18n } from "copytranslater";\n\nexport default defineI18n({\n  sourceLocale: "en",\n  locales: ["en", "nl"],\n  messages: "./i18n/messages",\n  staleTranslations: "error",\n  missingTranslations: "error",\n});\n`,
    "i18n/messages/en/common.ts": `export type CopyTranslaterFormat = 1;\n\nexport interface SourceRevisions {}\n\nexport interface MessageContext {\n  greeting: { description: "Example greeting" };\n}\n\nexport const greeting = ({ name }: { name: string }) => \`Hello, \${name}!\`;\n`,
    "i18n/messages/nl/common.ts": `import type * as Source from "../en/common.js";\n\nexport type CopyTranslaterFormat = 1;\n\nexport interface BasedOn {}\nexport interface Reviewed {}\n\nexport const greeting = (({ name }) => \`Hallo, \${name}!\`) satisfies typeof Source.greeting;\n`,
  };
  const created: string[] = [];
  for (const [relative, content] of Object.entries(files)) {
    const fileName = path.join(root, relative);
    try {
      await readFile(fileName);
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (await atomicWrite(fileName, content, { expectedContent: null })) created.push(fileName);
  }
  return created;
}
