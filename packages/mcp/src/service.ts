import {
  TypeScriptModuleStore,
  analyzeProject,
  isEmptyMessage,
  parseFunctionText,
  recoverSourceRevision,
  reportDiagnostics,
  type Diagnostic,
  type LocalizedMessage,
  type MessageQuery,
  type MessageRef,
  type WorkflowState,
} from "copytranslater";

export type DiagnosticCode = Diagnostic["code"];

export interface SearchMessagesInput extends MessageQuery {
  text?: string;
  limit: number;
  offset: number;
}

export interface MutationInput extends MessageRef {
  expectedSourceFingerprint: string;
  expectedTargetFingerprint: string | null;
}

export interface UpdateToolInput extends MutationInput {
  functionText?: string;
  review?: boolean;
  acknowledgeSource?: boolean;
}

export interface ValidationInput extends MessageQuery {
  id?: string;
  functionText?: string;
}

function sameRef(left: MessageRef, right: MessageRef): boolean {
  return left.locale === right.locale && left.namespace === right.namespace && left.id === right.id;
}

function messageSummary(message: LocalizedMessage): Record<string, unknown> {
  return {
    ref: message.ref,
    state: message.state,
    sourceFingerprint: message.sourceFingerprint,
    targetFingerprint: message.target?.semanticFingerprint ?? null,
    basedOn: message.basedOn ?? null,
    reviewed: message.reviewed ?? null,
    sourceFunction: message.source.functionText,
    targetFunction: message.target?.functionText ?? null,
    context: message.context ?? null,
  };
}

function matchingDiagnostics(diagnostics: Diagnostic[], messages: LocalizedMessage[], query: MessageQuery): Diagnostic[] {
  const refs = new Set(messages.map((message) => `${message.ref.locale}\0${message.ref.namespace}\0${message.ref.id}`));
  return diagnostics.filter((diagnostic) => {
    if (query.diagnostic && diagnostic.code !== query.diagnostic) return false;
    if (!diagnostic.ref) return !query.locale && !query.namespace && !query.state;
    if (query.locale && diagnostic.ref.locale !== query.locale) return false;
    if (query.namespace && diagnostic.ref.namespace !== query.namespace) return false;
    if (query.state && !refs.has(`${diagnostic.ref.locale}\0${diagnostic.ref.namespace}\0${diagnostic.ref.id}`)) return false;
    return true;
  });
}

export class CopyTranslaterMcpService {
  readonly store: TypeScriptModuleStore;

  constructor(
    readonly root = process.cwd(),
    readonly allowWrite = false,
  ) {
    this.store = new TypeScriptModuleStore(root);
  }

  private requireWrite(): void {
    if (!this.allowWrite) throw new Error("MCP write capability is disabled. Restart with `i18n mcp --write` after reviewing the project boundary.");
  }

  async getProject(): Promise<Record<string, unknown>> {
    const analysis = await analyzeProject(this.root);
    return {
      sourceLocale: analysis.config.sourceLocale,
      locales: analysis.config.locales,
      configuration: {
        messages: analysis.config.messages,
        staleTranslations: analysis.config.staleTranslations,
        missingTranslations: analysis.config.missingTranslations,
      },
      stores: [{
        id: this.store.id,
        capabilities: { ...this.store.capabilities, write: this.store.capabilities.write && this.allowWrite },
      }],
      capabilities: {
        passive: true,
        read: true,
        write: this.allowWrite,
        batchMutation: false,
        arbitraryFiles: false,
        shell: false,
        sql: false,
      },
    };
  }

  async searchMessages(input: SearchMessagesInput): Promise<Record<string, unknown>> {
    const query: MessageQuery = {};
    if (input.locale) query.locale = input.locale;
    if (input.namespace) query.namespace = input.namespace;
    if (input.state) query.state = input.state;
    if (input.diagnostic) query.diagnostic = input.diagnostic;
    const analysis = await analyzeProject(this.root, query);
    const needle = input.text?.trim().toLocaleLowerCase();
    const filtered = needle ? analysis.messages.filter((message) => {
      const haystack = [
        message.ref.id,
        message.ref.locale,
        message.ref.namespace,
        message.source.functionText,
        message.target?.functionText ?? "",
        JSON.stringify(message.context ?? {}),
      ].join("\n").toLocaleLowerCase();
      return haystack.includes(needle);
    }) : analysis.messages;
    const items = filtered.slice(input.offset, input.offset + input.limit).map(messageSummary);
    let truncated = false;
    while (items.length > 1 && JSON.stringify(items).length > 100_000) {
      items.pop();
      truncated = true;
    }
    const nextOffset = input.offset + items.length;
    return {
      total: filtered.length,
      count: items.length,
      offset: input.offset,
      hasMore: nextOffset < filtered.length,
      nextOffset: nextOffset < filtered.length ? nextOffset : null,
      truncated,
      messages: items,
    };
  }

  async getMessage(ref: MessageRef): Promise<Record<string, unknown>> {
    const message = await this.store.getMessage(ref);
    const analysis = await analyzeProject(this.root, { locale: ref.locale, namespace: ref.namespace });
    const diagnostics = reportDiagnostics(analysis).filter((diagnostic) => diagnostic.ref && sameRef(diagnostic.ref, ref));
    let sourceChange: Record<string, unknown> | null = null;
    if (message.state === "stale") {
      const recovered = message.basedOn
        ? await recoverSourceRevision(this.root, ref.namespace, ref.id, message.basedOn)
        : { functionText: null, recoverable: false, commit: null };
      sourceChange = {
        fromFingerprint: message.basedOn ?? null,
        toFingerprint: message.sourceFingerprint,
        previousSourceFunction: recovered.functionText,
        currentSourceFunction: message.source.functionText,
        recoverable: recovered.recoverable,
        commit: recovered.commit,
      };
    }
    return { ...messageSummary(message), diagnostics, sourceChange };
  }

  async updateMessage(input: UpdateToolInput): Promise<Record<string, unknown>> {
    this.requireWrite();
    const before = await this.store.getMessage(input);
    if (before.sourceFingerprint !== input.expectedSourceFingerprint) throw new Error("Source fingerprint conflict. Read the message again before updating.");
    if ((before.target?.semanticFingerprint ?? null) !== input.expectedTargetFingerprint) throw new Error("Target fingerprint conflict. Read the message again before updating.");
    let functionText = input.functionText;
    if (!functionText && input.acknowledgeSource) {
      if (!before.target) throw new Error("A missing translation cannot acknowledge a source change without functionText.");
      functionText = before.target.functionText;
    }
    if (!functionText) throw new Error("update_message requires functionText or acknowledgeSource=true.");
    const result = await this.store.updateMessage({
      ...input,
      functionText,
      expectedTargetFingerprint: input.expectedTargetFingerprint,
      review: input.review === true,
    });
    const after = await this.store.getMessage(input);
    return {
      changed: result.changed,
      diff: { before: messageSummary(before), after: messageSummary(after) },
    };
  }

  async reviewMessage(input: MutationInput): Promise<Record<string, unknown>> {
    this.requireWrite();
    const before = await this.store.getMessage(input);
    if (!before.target) throw new Error("Missing translations must be updated before review.");
    if (before.state === "stale") throw new Error("Stale translations must acknowledge or update to the current source before review.");
    const result = await this.store.updateMessage({
      ...input,
      functionText: before.target.functionText,
      expectedTargetFingerprint: input.expectedTargetFingerprint,
      review: true,
    });
    const after = await this.store.getMessage(input);
    return { changed: result.changed, diff: { before: messageSummary(before), after: messageSummary(after) } };
  }

  async validate(input: ValidationInput): Promise<Record<string, unknown>> {
    const query: MessageQuery = {};
    if (input.locale) query.locale = input.locale;
    if (input.namespace) query.namespace = input.namespace;
    if (input.state) query.state = input.state;
    if (input.diagnostic) query.diagnostic = input.diagnostic;
    const analysis = await analyzeProject(this.root, query);
    let diagnostics = matchingDiagnostics(reportDiagnostics(analysis), analysis.messages, query);
    if (input.id) {
      if (!input.locale || !input.namespace) throw new Error("Validating one message requires locale, namespace, and id.");
      const ref = { locale: input.locale, namespace: input.namespace, id: input.id };
      const current = await this.store.getMessage(ref);
      diagnostics = diagnostics.filter((diagnostic) => diagnostic.ref && sameRef(diagnostic.ref, ref));
      if (input.functionText !== undefined) {
        try {
          const proposed = parseFunctionText(input.id, input.functionText);
          if (proposed.contractFingerprint !== current.source.contractFingerprint) {
            diagnostics.push({ code: "invalid", severity: "error", message: "Proposed message has an incompatible contract", ref });
          }
          if (isEmptyMessage(proposed)) diagnostics.push({ code: "empty", severity: "error", message: "Proposed message is empty", ref });
        } catch (error) {
          diagnostics.push({ code: "invalid", severity: "error", message: error instanceof Error ? error.message : "Invalid proposed message", ref });
        }
      }
    } else if (input.functionText !== undefined) {
      throw new Error("functionText requires locale, namespace, and id.");
    }
    return {
      valid: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
      errors: diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
      warnings: diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
      diagnostics,
    };
  }

  async getReport(query: MessageQuery): Promise<Record<string, unknown>> {
    const analysis = await analyzeProject(this.root, query);
    const diagnostics = matchingDiagnostics(reportDiagnostics(analysis), analysis.messages, query);
    const states: Record<WorkflowState, number> = { missing: 0, stale: 0, current: 0, reviewed: 0 };
    const locales: Record<string, { total: number; missing: number; stale: number; current: number; reviewed: number }> = {};
    for (const message of analysis.messages) {
      states[message.state] += 1;
      const locale = locales[message.ref.locale] ?? { total: 0, missing: 0, stale: 0, current: 0, reviewed: 0 };
      locale.total += 1;
      locale[message.state] += 1;
      locales[message.ref.locale] = locale;
    }
    const diagnosticCounts = Object.fromEntries([...new Set(diagnostics.map((item) => item.code))].sort().map((code) => [code, diagnostics.filter((item) => item.code === code).length]));
    const ready = states.current + states.reviewed;
    return {
      total: analysis.messages.length,
      translated: analysis.messages.filter((message) => message.target && !isEmptyMessage(message.target)).length,
      ready,
      coverage: analysis.messages.length ? ready / analysis.messages.length : 1,
      states,
      locales,
      diagnostics: diagnosticCounts,
      errors: diagnostics.filter((item) => item.severity === "error").length,
      warnings: diagnostics.filter((item) => item.severity === "warning").length,
    };
  }
}
