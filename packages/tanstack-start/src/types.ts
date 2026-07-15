import type { NamespaceLoader } from "@copytranslater/runtime";

export type LocaleStrategy = "url" | "cookie" | "acceptLanguage" | "sourceLocale";
export type LocalePrefix = "all" | "all-except-source";

export interface LocaleRoutingOptions<Locale extends string = string> {
  sourceLocale: Locale;
  locales: readonly Locale[];
  prefix?: LocalePrefix;
  strategy?: readonly LocaleStrategy[];
  cookie?: string;
  exclude?: readonly (string | RegExp)[];
}

export interface LocaleResolution<Locale extends string = string> {
  locale: Locale;
  pathname: string;
  redirect?: string;
  source: LocaleStrategy;
}

export interface I18nHydrationState<Locale extends string = string, Namespace extends string = string> {
  locale: Locale;
  namespaces: Namespace[];
}

export interface I18nRequest<Locale extends string, Namespace extends string, Module> {
  readonly locale: Locale;
  preload(namespaces: readonly Namespace[]): Promise<void>;
  get(namespace: Namespace): Promise<Module>;
  dehydrate(): I18nHydrationState<Locale, Namespace>;
}

export type LocaleNamespaceLoader<Locale extends string, Namespace extends string, Module> =
  (locale: Locale, namespace: Namespace) => ReturnType<NamespaceLoader<Module>>;

export interface VisibleMessageRef {
  locale: string;
  namespace: string;
  id: string;
}

export type VisibleMessageState = "missing" | "stale" | "current" | "reviewed";

export interface VisibleMessageRegistration {
  ref: VisibleMessageRef;
  source: string;
  target: string;
  state: VisibleMessageState;
  sourceFingerprint?: string;
  description?: string;
  maxLength?: number;
  parameters?: Record<string, string | number | boolean>;
  sourceLocation?: string;
}
