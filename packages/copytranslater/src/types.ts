export type WorkflowState = "missing" | "stale" | "current" | "reviewed";
export type Policy = "error" | "warning" | "allow";

export interface I18nConfig {
  sourceLocale: string;
  locales: readonly string[];
  messages: string;
  staleTranslations: Policy;
  missingTranslations: Policy;
}

export interface MessageRef {
  locale: string;
  namespace: string;
  id: string;
}

export interface ParsedMessage {
  id: string;
  functionText: string;
  semanticFingerprint: string;
  contractFingerprint: string;
  canonical: unknown;
}

export interface ParsedModule {
  fileName: string;
  messages: Map<string, ParsedMessage>;
  revisions: Record<string, string>;
  reviewed: Record<string, string>;
  context: Record<string, Record<string, string | number | boolean>>;
}

export interface Diagnostic {
  code: "invalid" | "unsynchronized" | "missing" | "empty" | "stale" | "orphan" | "unsafe";
  severity: "error" | "warning";
  message: string;
  ref?: MessageRef;
}

export interface LocalizedMessage {
  ref: MessageRef;
  state: WorkflowState;
  sourceFingerprint: string;
  basedOn?: string;
  reviewed?: string;
  source: ParsedMessage;
  target?: ParsedMessage;
  context?: Record<string, string | number | boolean>;
}

export interface MessageQuery {
  locale?: string;
  namespace?: string;
  state?: WorkflowState;
  diagnostic?: Diagnostic["code"];
}

export interface UpdateMessageInput extends MessageRef {
  functionText: string;
  expectedSourceFingerprint: string;
  expectedTargetFingerprint?: string | null;
  review?: boolean;
}

export interface UpdateResult {
  changed: boolean;
  before: string;
  after: string;
}

export interface LocalizationStore {
  id: string;
  capabilities: { read: boolean; write: boolean; batch?: boolean; transactions?: boolean };
  getMessage(ref: MessageRef): Promise<LocalizedMessage>;
  updateMessage(input: UpdateMessageInput): Promise<UpdateResult>;
  listMessages(query?: MessageQuery): Promise<LocalizedMessage[]>;
}
