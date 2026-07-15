# CopyTranslater

CopyTranslater is a local-first internationalization toolkit for TypeScript applications. It combines native TypeScript message modules, request-safe TanStack Start integration, an in-context development editor, deterministic JSON/ICU interchange, and a passive MCP server with guarded single-message writes.

## Try the slice

Requires Node.js 22.12 or newer.

```sh
npm install
npm run check
npm run build
npm run example
```

The example is served by Vite and demonstrates direct named imports, runtime locale/namespace loading, locale-preserving URLs, visible-message inspection, source/target editing, review, source-staleness previews, and hot reload. Run it in development and choose **Inspect messages**.

## Start a project

Build this workspace, then run the CLI from the application root:

```sh
node /path/to/copytranslater/packages/copytranslater/dist/cli.js init
node /path/to/copytranslater/packages/copytranslater/dist/cli.js sync
node /path/to/copytranslater/packages/copytranslater/dist/cli.js check
node /path/to/copytranslater/packages/copytranslater/dist/cli.js status --locale nl
node /path/to/copytranslater/packages/copytranslater/dist/cli.js export --format json --output translations.json
node /path/to/copytranslater/packages/copytranslater/dist/cli.js mcp
```

`init` creates a small `en`/`nl` project without replacing existing files. `sync` parses the bounded message grammar, calculates semantic SHA-256 fingerprints, updates `SourceRevisions` with stable ordering, writes atomically, and skips byte-identical output. `check` reports syntax, synchronization, contract, missing, stale, and orphan diagnostics according to project policy.

Supported message bodies are intentionally narrow:

- String literals and template literals using declared parameters.
- `plural`, `select`, `formatNumber`, `formatDateTime`, and `formatList` calls.
- Nested combinations of those helpers and literal option objects.

Arbitrary calls, property access, statements, control flow, side effects, spreads, and undeclared variables are rejected.

## Workspace

- `packages/copytranslater`: parser, fingerprints, deterministic writer, store, project analysis, and CLI.
- `packages/runtime`: plural/select helpers, cached `Intl` formatters, locale state, and cached namespace loaders.
- `packages/tanstack-start`: request middleware, routing/preload helpers, React instrumentation, overlay, and Vite bridge.
- `packages/mcp`: passive stdio MCP server with seven composable project tools.
- `examples/tanstack-start-basic`: browser example for native messages and the development editing workflow.

The test suite covers grammar acceptance/rejection, semantic and contract fingerprints, atomic write avoidance, state derivation, optimistic concurrency, compile-time `satisfies` contracts, request isolation, locale routing, hydration reuse, overlay interaction, guarded bridge writes, static-import tree-shaking, dynamic locale chunking, and production authoring-code removal.

## Guides

- [Quick start](./docs/quick-start.md)
- [Native format and interchange specification](./docs/format-specification.md)
- [TanStack Start integration guide](./docs/integration-guide.md)
- [MCP setup and tool guide](./docs/mcp-setup.md)
- [Security model and write-path review](./SECURITY.md)

## TanStack Start integration

Register the request middleware in `src/start.ts` and preload namespaces from route loaders. Each request owns its locale and namespace cache; no server request uses the runtime's browser-global locale state.

```ts
import { createStart } from "@tanstack/react-start";
import { createCopyTranslaterMiddleware } from "@copytranslater/tanstack-start/middleware";

const i18nMiddleware = createCopyTranslaterMiddleware({
  sourceLocale: "en",
  locales: ["en", "nl", "de"],
  prefix: "all-except-source",
  strategy: ["url", "cookie", "acceptLanguage", "sourceLocale"],
});

export const startInstance = createStart(() => ({
  requestMiddleware: [i18nMiddleware],
}));
```

Add the development bridge to Vite. The plugin applies only to the development server and rejects cross-origin requests; every mutation still passes through the bounded parser, expected-fingerprint check, configured message root, and atomic writer.

```ts
import { copyTranslater } from "@copytranslater/tanstack-start/vite";

export default defineConfig({
  plugins: [copyTranslater(), tanstackStart(), react()],
});
```

Wrap visible text with `Localized` and load the overlay only in development:

```tsx
<Localized message={import.meta.env.DEV ? registration : undefined}>
  {translatedValue}
</Localized>

if (import.meta.env.DEV) {
  import("@copytranslater/tanstack-start/overlay")
    .then(({ mountCopyTranslaterOverlay }) => mountCopyTranslaterOverlay());
}
```
