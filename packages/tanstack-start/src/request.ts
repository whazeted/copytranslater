import type { I18nHydrationState, I18nRequest, LocaleNamespaceLoader } from "./types.js";

export function createI18nRequest<Locale extends string, Namespace extends string, Module>(options: {
  locale: Locale;
  load: LocaleNamespaceLoader<Locale, Namespace, Module>;
  preloaded?: Iterable<readonly [Namespace, Module]>;
}): I18nRequest<Locale, Namespace, Module> {
  const loaded = new Map<Namespace, Promise<Module>>();
  const completed = new Set<Namespace>();
  for (const [namespace, module] of options.preloaded ?? []) {
    loaded.set(namespace, Promise.resolve(module));
    completed.add(namespace);
  }
  const get = (namespace: Namespace): Promise<Module> => {
    const existing = loaded.get(namespace);
    if (existing) return existing;
    const pending = options.load(options.locale, namespace).then((module) => {
      completed.add(namespace);
      return module;
    });
    loaded.set(namespace, pending);
    return pending;
  };
  return {
    locale: options.locale,
    get,
    async preload(namespaces) { await Promise.all(namespaces.map(get)); },
    dehydrate: () => ({ locale: options.locale, namespaces: [...completed] }),
  };
}

export async function hydrateI18nState<Locale extends string, Namespace extends string, Module>(
  state: I18nHydrationState<Locale, Namespace>,
  load: LocaleNamespaceLoader<Locale, Namespace, Module>,
): Promise<I18nRequest<Locale, Namespace, Module>> {
  const modules = await Promise.all(state.namespaces.map(async (namespace) => [namespace, await load(state.locale, namespace)] as const));
  return createI18nRequest({ locale: state.locale, load, preloaded: modules });
}

export async function preloadRouteNamespaces<Locale extends string, Namespace extends string, Module>(
  request: I18nRequest<Locale, Namespace, Module>,
  namespaces: readonly Namespace[],
): Promise<I18nHydrationState<Locale, Namespace>> {
  await request.preload(namespaces);
  return request.dehydrate();
}
