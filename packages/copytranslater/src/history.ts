import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { loadConfig } from "./config.js";
import { parseModuleText } from "./parser.js";
import { resolveMessageModule } from "./security.js";

const executeFile = promisify(execFile);

export interface RecoveredSourceRevision {
  fingerprint: string;
  functionText: string | null;
  commit: string | null;
  recoverable: boolean;
}

/** Recover a prior source function using fixed, non-shell Git invocations. */
export async function recoverSourceRevision(
  root: string,
  namespace: string,
  id: string,
  fingerprint: string,
): Promise<RecoveredSourceRevision> {
  const unavailable = (): RecoveredSourceRevision => ({ fingerprint, functionText: null, commit: null, recoverable: false });
  try {
    const { config } = await loadConfig(root);
    const messagesRoot = path.resolve(root, config.messages);
    const fileName = await resolveMessageModule(messagesRoot, config.sourceLocale, namespace);
    const relative = path.relative(path.resolve(root), fileName);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return unavailable();
    const gitPath = relative.split(path.sep).join("/");
    const log = await executeFile("git", ["-C", root, "log", "--format=%H", "-n", "100", "--", gitPath], {
      encoding: "utf8",
      timeout: 3_000,
      maxBuffer: 1_000_000,
      windowsHide: true,
    });
    for (const commit of log.stdout.split(/\r?\n/).filter(Boolean)) {
      const shown = await executeFile("git", ["-C", root, "show", `${commit}:${gitPath}`], {
        encoding: "utf8",
        timeout: 3_000,
        maxBuffer: 5_000_000,
        windowsHide: true,
      }).catch(() => undefined);
      if (!shown) continue;
      const message = parseModuleText(fileName, shown.stdout).messages.get(id);
      if (message?.semanticFingerprint === fingerprint) {
        return { fingerprint, functionText: message.functionText, commit, recoverable: true };
      }
    }
    return unavailable();
  } catch {
    return unavailable();
  }
}
