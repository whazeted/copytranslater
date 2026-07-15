export type PluralOptions<T> = {
  zero?: () => T;
  one?: () => T;
  two?: () => T;
  few?: () => T;
  many?: () => T;
  other: () => T;
};

export function plural<T>(
  value: number,
  options: PluralOptions<T>,
  locale = activeLocale,
): T {
  const category = new Intl.PluralRules(locale).select(value);
  return (options[category] ?? options.other)();
}

export function select<K extends PropertyKey, T>(
  value: K,
  options: Record<K, () => T> & { other?: () => T },
): T {
  const selected = options[value] ?? options.other;
  if (!selected) throw new RangeError(`No select variant for ${String(value)}`);
  return selected();
}

let activeLocale = "en";

export function setLocale(locale: string): void {
  activeLocale = locale;
}

export function getLocale(): string {
  return activeLocale;
}

const formatterCache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.ListFormat>();

function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.ListFormat>(
  kind: string,
  locale: string,
  options: object,
  create: () => T,
): T {
  const key = `${kind}:${locale}:${JSON.stringify(options, Object.keys(options).sort())}`;
  const existing = formatterCache.get(key);
  if (existing) return existing as T;
  const formatter = create();
  formatterCache.set(key, formatter);
  return formatter;
}

export function formatNumber(
  value: number,
  options: Intl.NumberFormatOptions = {},
  locale = activeLocale,
): string {
  return cached("number", locale, options, () => new Intl.NumberFormat(locale, options)).format(value);
}

export function formatDateTime(
  value: Date | number,
  options: Intl.DateTimeFormatOptions = {},
  locale = activeLocale,
): string {
  return cached("date", locale, options, () => new Intl.DateTimeFormat(locale, options)).format(value);
}

export function formatList(
  value: Iterable<string>,
  options: Intl.ListFormatOptions = {},
  locale = activeLocale,
): string {
  return cached("list", locale, options, () => new Intl.ListFormat(locale, options)).format(value);
}

export type NamespaceLoader<T> = () => Promise<T>;

export function createNamespaceLoader<
  Locale extends string,
  Namespace extends string,
  Module,
>(loaders: Record<Locale, Record<Namespace, NamespaceLoader<Module>>>) {
  const cache = new Map<string, Promise<Module>>();

  return (locale: Locale, namespace: Namespace): Promise<Module> => {
    const key = `${locale}:${namespace}`;
    const existing = cache.get(key);
    if (existing) return existing;
    const load = loaders[locale]?.[namespace];
    if (!load) return Promise.reject(new RangeError(`Unknown namespace ${key}`));
    const pending = load();
    cache.set(key, pending);
    return pending;
  };
}
