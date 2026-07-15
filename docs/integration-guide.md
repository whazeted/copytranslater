# TanStack Start integration

Register request middleware in `src/start.ts`. Each request gets an isolated locale and namespace cache; server requests do not use browser-global locale state.

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

Preload route namespaces in loaders and pass their serialized state into hydration. Use the package link and redirect helpers so locale prefixes, query strings, and fragments are preserved. Asset, API, RPC, and framework-internal routes are excluded from locale rewriting.

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
