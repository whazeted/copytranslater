# TanStack Start integration

Register request middleware in `src/start.ts`. Each request gets isolated locale resolution and a namespace cache.

```ts
import { createStart } from "@tanstack/react-start";
import { createCopyTranslaterMiddleware } from "@copytranslater/tanstack-start/middleware";

const i18n = createCopyTranslaterMiddleware({
  sourceLocale: "en",
  locales: ["en", "nl", "de"],
  prefix: "all-except-source",
  strategy: ["url", "cookie", "acceptLanguage", "sourceLocale"],
});

export const startInstance = createStart(() => ({ requestMiddleware: [i18n] }));
```

Read the middleware context inside a server function, create a request-local namespace cache, and return its serialized preload state from the route loader:

```ts
const getRouteData = createServerFn({ method: "GET" }).handler(async ({ context }) => {
  const locale = context.copytranslater.locale;
  const request = createI18nRequest({ locale, load: loadMessages });
  const hydration = await preloadRouteNamespaces(request, ["checkout"]);
  const messages = await request.get("checkout");
  return { locale, hydration, title: messages.title() };
});

export const Route = createFileRoute("/{-$locale}")({
  loader: () => getRouteData(),
  component: Page,
});
```

On the client, `hydrateI18nState` loads each serialized namespace once and seeds the request cache before the first message read. Use `localizeHref` or the package redirect helper so locale prefixes, query strings, and fragments are preserved. Asset, API, RPC, and framework-internal routes are excluded from locale rewriting. The runnable example contains the complete SSR and hydration flow.

For in-context development editing, add the Vite bridge:

```ts
import { copyTranslater } from "@copytranslater/tanstack-start/vite";

export default defineConfig({
  plugins: [copyTranslater(), tanstackStart(), react()],
});
```

Wrap visible text in `Localized` and load the overlay only in development:

```tsx
<Localized message={import.meta.env.DEV ? registration : undefined}>
  {translatedValue}
</Localized>

if (import.meta.env.DEV) {
  import("@copytranslater/tanstack-start/overlay")
    .then(({ mountCopyTranslaterOverlay }) => mountCopyTranslaterOverlay());
}
```

The bridge accepts same-origin JSON requests only, caps request bodies at 1 MB, and routes all changes through the bounded parser, configured store, fingerprints, locks, and atomic writer. Production builds must define `import.meta.env.DEV` normally; the bundle tests verify that overlay strings, write endpoints, store code, and MCP registration are absent.
