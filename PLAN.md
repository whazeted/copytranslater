# CopyTranslater Implementation Plan

## 1. Vision

CopyTranslater is a local-first, open-source internationalization toolkit for web applications. It combines:

- A TypeScript source generator that writes typed, tree-shakable, code-splittable message functions directly into the application source tree.
- A development overlay for editing visible text and hidden localized content in context.
- Native TypeScript message modules that track every translation against an exact semantic revision of the source locale.
- Ordered locale detection and localized routing inspired by Paraglide's middleware model.
- First-class localization of Drizzle-managed database content.
- A passive MCP server that lets an existing coding agent inspect and modify localization data using the user's existing agent/model subscription.

The tool must remain useful without an agent. Manual editing, source generation, validation, routing, and database localization are deterministic core features; MCP adds agent-driven automation on top.

## 2. Product Principles

1. **Local first**: no account, hosted service, or network connection is required for core functionality.
2. **Open and portable**: generated message modules follow documented TypeScript conventions and can be imported from or exported to common ecosystems.
3. **Git friendly**: deterministic source generation, stable ordering, minimal generated churn, and ordinary text merges.
4. **Base locale as source of truth**: every translation records the base revision from which it was produced.
5. **Context at the point of editing**: translators can see the original, target, source change, page context, and metadata together.
6. **Safe writes**: every writable file, database resource, route, or metadata field is explicitly configured and validated.
7. **Fast production runtime**: authoring metadata stays out of production bundles.
8. **Framework-neutral core**: TanStack Start is the first reference integration, not a hard dependency of source generation or runtime modules.
9. **MCP is passive**: the server exposes tools and resources; it cannot initiate an agent turn or push a prompt to an agent.
10. **No unnecessary reinvention**: own the generated TypeScript conventions while accepting ICU-compatible input and using platform `Intl` behavior.

## 3. Scope

### Initial scope

- TypeScript-capable web build pipelines, including JavaScript applications whose bundler accepts generated TypeScript modules.
- TanStack Start reference integration.
- Visible UI messages, SEO metadata, accessibility text, image alt text, and localized routes.
- TypeScript-backed source and translation modules using the native CopyTranslater conventions.
- Drizzle-backed localized database fields.
- Development-only browser overlay.
- CLI, TypeScript source generator, middleware, validation, and MCP server.
- ICU-style variables, plurals, selects, rich-text placeholders, and locale-aware formatting.

### Explicit initial non-goals

- Hosted translation management service.
- Billing, word quotas, seats, or vendor procurement.
- Translation marketplace.
- MCP-driven autonomous background work.
- Arbitrary database access or arbitrary filesystem access through MCP.
- Full enterprise identity and permission management.
- Mobile-native SDKs.
- Inventing a new plural or message grammar in version 1.

## 4. Repository and Package Layout

Use a monorepo so the deterministic core, framework integrations, and development tooling remain separate.

```text
packages/
  core/                 Shared domain model, hashing, validation, store contracts
  source/               TypeScript module inspection and canonical conventions
  generator/            TypeScript Compiler API source generation and updates
  runtime/              Locale context, formatters, loaders, fallbacks
  routing/              Locale strategies, URL localization, middleware
  drizzle/              Drizzle storage adapter and helpers
  devtools/             Browser overlay UI
  vite/                 Vite plugin and development bridge
  tanstack-start/       TanStack Start integration
  mcp/                  Passive MCP server
  cli/                  CLI entry point
  adapters/
    paraglide/          Import/export adapter
    i18next/            Import/export adapter
    formatjs/           Import/export adapter
examples/
  tanstack-start-basic/
  tanstack-start-drizzle/
  tanstack-start-seo/
docs/
```

Do not require every consumer to install the whole monorepo. Provide a convenience package only after the individual package boundaries are stable.

## 5. Native TypeScript Message Format

### 5.1 Files

```text
i18n.config.ts
i18n/
  messages/
    en/
      common.ts
      checkout.ts
      seo.ts
    nl/
      common.ts
      checkout.ts
      seo.ts
    de/
      common.ts
      checkout.ts
      seo.ts
  loaders.ts
  runtime.ts
  routes.ts
```

The files under `i18n/messages/` are committed canonical source, not an intermediate catalog or disposable build artifact. CopyTranslater writes ordinary TypeScript modules that the application's existing TypeScript and bundler pipeline consumes directly.

### 5.2 Configuration

```ts
export default defineI18n({
  sourceLocale: "en",
  locales: ["en", "nl", "de"],
  messages: "./i18n/messages",
  routes: "./i18n/routes.ts",
  staleTranslations: "error",
  missingTranslations: "error",
});
```

Configuration, runtime functions, database handles, custom locale strategies, and framework objects live in `i18n.config.ts`. There is no separate JSON project manifest.

### 5.3 Source-locale modules

Each namespace is a native ESM module. Message values are executable, typed functions. Source revisions and authoring metadata are represented with type-only declarations so TypeScript erases them from production JavaScript.

```ts
import { plural } from "@copytranslater/runtime";

export type CopyTranslaterFormat = 1;

export interface SourceRevisions {
  completePurchase: "sha256:2d5c...";
  basketItems: "sha256:a819...";
}

export interface MessageContext {
  completePurchase: {
    description: "Primary checkout submit button";
    tags: readonly ["checkout", "button"];
    maxLength: 40;
    sourceLocations: readonly [{
      file: "src/routes/checkout.tsx";
      line: 42;
    }];
  };
}

export const completePurchase = () =>
  "Complete your purchase";

export const basketItems = ({ count }: { count: number }) =>
  plural(count, {
    one: () => "1 item",
    other: () => `${count} items`,
  });
```

The generated function body is the canonical semantic message representation. Simple messages generate as literal-returning functions; plurals, selects, rich text, and formatting generate as direct expressions plus small tree-shakable runtime helpers.

### 5.4 Translation modules

Translations use the same named exports as the source namespace. `BasedOn` records the exact semantic source fingerprint used to produce each translation. Function signatures are checked against the source module.

```ts
import type * as Source from "../en/checkout";
import type { Assert, Equal } from "@copytranslater/runtime/types";
import { plural } from "@copytranslater/runtime";

export type CopyTranslaterFormat = 1;

export interface BasedOn {
  completePurchase: "sha256:2d5c...";
  basketItems: "sha256:91ab...";
}

export interface Reviewed {
  completePurchase: "sha256:2d5c...";
}

type __STALE_nl_basketItems = Assert<Equal<
  BasedOn["basketItems"],
  Source.SourceRevisions["basketItems"]
>>;
// Intentionally fails semantic TypeScript checking while this translation is stale.

export const completePurchase =
  (() => "Rond je aankoop af")
  satisfies typeof Source.completePurchase;

export const basketItems =
  (({ count }) => plural(count, {
    one: () => "1 artikel",
    other: () => `${count} artikelen`,
  })) satisfies typeof Source.basketItems;
```

According to project policy, the generator emits per-message type assertions for stale translations and namespace-level assertions for missing translations. A normal semantic TypeScript check such as `tsc --noEmit` therefore produces build errors without a CopyTranslater compilation phase. Bundlers that only strip TypeScript must run typechecking as a separate build or CI step.

Policies are explicit:

- `error`: emit a failing type assertion and fail semantic TypeScript checking.
- `warning`: omit the failing assertion but report the condition through devtools, CLI, and CI annotations.
- `allow`: retain the derived status without failing or warning.

Function-contract incompatibilities remain TypeScript errors through `satisfies` regardless of wording-staleness policy.

### 5.5 Derived status

Do not persist a redundant status field. Derive it from module declarations:

- `missing`: the target module has no matching message export.
- `stale`: `BasedOn` differs from the current `SourceRevisions` fingerprint.
- `reviewed`: `Reviewed` equals both `BasedOn` and the current source fingerprint.
- `current`: `BasedOn` equals the current source fingerprint but `Reviewed` does not.
- `incompatible`: the translation function no longer satisfies the source function contract or its canonical message shape changed.
- `orphaned`: a target export remains after the source export is removed.
- `base-fallback`: runtime displays the source because the target export is unavailable.
- `intentionally-unchanged`: the target value is unchanged but `BasedOn` explicitly advances to the current source fingerprint.

### 5.6 Semantic fingerprints

Create fingerprints from a canonical representation of the generated message AST containing:

- Literal text.
- Variable names and types.
- Plural and select variants.
- Rich-text placeholders.
- Formatter configuration.

Exclude TypeScript formatting, declaration order, source line numbers, descriptions, screenshots, and tags. Track context separately with an optional `contextFingerprint` so context changes can produce warnings without making content stale.

Use a second contract or shape fingerprint internally to distinguish a wording change from an incompatible parameter, plural, select, or rich-text change. Exact source synchronization is still based on the full semantic fingerprint rather than subjective major/minor/patch labels.

### 5.7 Source history

- Use Git as the complete audit history of generated TypeScript modules.
- Retain every previous source value still referenced by a translation in an optional type-only `SourceHistory` declaration.
- Retain a configurable number of recent unreferenced revisions when richer local diffs are desired.
- Provide a compaction command that removes old, unreferenced type-only history entries.
- Avoid timestamps and usernames in generated modules by default to reduce diff noise.

### 5.8 Source generation and direct edits

Use the TypeScript Compiler API directly for all native module generation and updates:

- Parse modules with `ts.createSourceFile`.
- Create and update declarations with `ts.factory`.
- Emit deterministic modules with `ts.Printer`.
- Never use string concatenation for message expressions or type declarations.
- Write atomically and do not rewrite byte-identical files.

Dedicated message modules are owned by CopyTranslater, but developers may edit their generated function bodies directly when they preserve the supported module conventions.

On `dev`, `build`, or `validate`:

1. Parse and canonicalize each message function AST.
2. Recalculate its semantic and contract fingerprints.
3. Detect a fingerprint mismatch without a corresponding `SourceRevisions` update.
4. Report an unrecorded source change.
5. Allow `i18n reconcile` to update the source fingerprint and retain the previous source value when required.

Development may offer safe automatic reconciliation with a visible notification. CI rejects unreconciled source changes and applies the configured missing/stale translation policy.

## 6. Shared Domain and Store Model

All storage adapters implement a common logical model. Native TypeScript message modules and Drizzle-managed application content remain separate physical stores. The shared model lets the overlay, CLI, and MCP treat them consistently without copying database content into source modules.

```ts
interface LocalizationStore {
  id: string;
  capabilities: {
    read: boolean;
    write: boolean;
    batch?: boolean;
    history?: boolean;
    transactions?: boolean;
  };

  getMessage(ref: MessageRef): Promise<LocalizedMessage>;
  updateMessage(input: UpdateMessageInput): Promise<UpdateResult>;
  listMessages(query: MessageQuery): Promise<LocalizedMessage[]>;
  findMissing(locales: string[]): Promise<MessageRef[]>;
  findStale(locales: string[]): Promise<MessageRef[]>;
}
```

All updates return structured diffs. Mutations accept expected source revisions or fingerprints for optimistic concurrency.

Initial stores:

- Native TypeScript message modules backed by the TypeScript Compiler API.
- Drizzle.
- In-memory test store.
- Read-only external adapter base class.

## 7. Source Generation and Native Runtime

### 7.1 Goals

- Generate direct typed message functions into the application source tree.
- Use TypeScript as the canonical persisted format and the application's normal compiler/bundler as the only build compiler.
- Perform no production catalog parsing or CopyTranslater compilation phase.
- Message-level tree-shaking.
- Native locale and namespace splitting through statically analyzable ESM imports.
- Deterministic TypeScript Compiler API output for build caching and clean Git diffs.
- Compile-time parameter, missing-translation, and stale-translation diagnostics.
- Synchronous rendering after locale preload.
- Request-safe SSR.
- Type-only authoring metadata erased from production output.

### 7.2 Native source layout

```text
i18n/
  runtime.ts
  loaders.ts
  messages/
    en/
      common.ts
      checkout.ts
    nl/
      common.ts
      checkout.ts
```

Message modules expose named functions directly:

```ts
import { completePurchase } from "~/i18n/messages/nl/checkout";

completePurchase();
```

For runtime-selected locales, generated loaders return a namespace whose function types are derived from the source locale:

```ts
const checkoutLoaders = {
  en: () => import("./messages/en/checkout"),
  nl: () => import("./messages/nl/checkout"),
  de: () => import("./messages/de/checkout"),
} as const;

const checkout = await checkoutLoaders[locale]();
checkout.completePurchase();
```

Framework integrations preload the required locale and namespaces, then expose the loaded typed functions synchronously during rendering.

### 7.3 Generation and splitting modes

#### Direct static imports

Applications that know the locale at build time import locale modules directly. The bundler performs ordinary named-export tree-shaking with no runtime registry.

#### Locale split

Generate statically analyzable dynamic imports per locale. Middleware or a route loader calls `loadLocale(locale)` before rendering. Message functions remain synchronous after preload.

#### Locale and namespace split

Load only the active locale and namespaces required by the current route:

```ts
await loadTranslations({
  locale: "nl",
  namespaces: ["common", "checkout"]
});
```

Locale-plus-namespace modules are the recommended production layout. Splitting comes from the generated module graph rather than a CopyTranslater-specific compilation mode.

### 7.4 Dynamic keys

Dynamic dictionary lookup prevents full message-level tree-shaking. Support it only through an explicit generated registry. Enabling dynamic access for a namespace opts that namespace out of granular tree-shaking.

### 7.5 Caching

Implement distinct cache layers:

- **Generator cache**: fingerprint parsed message ASTs and options; update only changed locale/namespace modules.
- **Build cache**: do not rewrite byte-identical TypeScript modules.
- **Browser/CDN cache**: use content-hashed immutable locale chunks.
- **Formatter cache**: reuse `Intl` formatter instances by locale and options.
- **Server module cache**: reuse application-compiled modules while keeping active locale request-scoped.
- **Database cache interface**: permit memory, Redis, KV, or application-defined caches with resource/row/field/locale invalidation tags.

### 7.6 Production stripping

TypeScript erases `SourceRevisions`, `BasedOn`, `Reviewed`, `SourceHistory`, context interfaces, and stale-check aliases. Production output must additionally omit:

- Source history.
- Review state.
- Screenshots and descriptions.
- Source-code locations.
- Editing endpoints.
- Database write metadata.
- Overlay registration code.

## 8. Development Overlay

### 8.1 Entry point

A floating TanStack-style button appears only in development. It opens the panel and toggles inspection mode.

### 8.2 Inspection behavior

- Highlight localized elements on hover.
- Click an element to resolve its message and store origin.
- Support text rendered on the client, server, or from a database.
- Display badges for images and elements with hidden localized attributes.
- Keep overlay metadata associated with DOM elements without changing production output.

### 8.3 Translation editor

Always show the base locale and target locale together.

Base side:

- Current source value.
- Read-only by default.
- Source revision and synchronization metadata.
- Previous source value when the target is stale.
- Inline source diff.
- Description, variables, screenshot, route, and source-code location.
- Explicit action to edit the base value.

Target side:

- Editable translation.
- Missing/current/stale/reviewed status.
- Source revision used for the translation.
- Plural, select, and rich-text variant editing.
- Variable, markup, and length validation.
- Save, save and review, revert, copy source, and acknowledge source change.
- Preview in the page.
- Navigate to the next missing or stale message.

Saves update the target function, `BasedOn`, review metadata, and stale assertion through one TypeScript Compiler API operation followed by an atomic file replacement.

Editing a base message must preview the number of translations that will become stale before committing the change.

### 8.4 Content tabs

- Visible text.
- SEO and social metadata.
- Image alt text and localized assets.
- Accessibility text and ARIA labels.
- Routes and pathnames.
- Database content.
- Page-wide missing and stale messages.

### 8.5 SEO and hidden content

Support editing:

- Document title and meta description.
- Canonical URL.
- Open Graph and Twitter metadata.
- Structured-data string fields.
- Image alt text, title, caption, and localized source.
- Input placeholders, tooltips, and accessible names.
- Localized slug and breadcrumb label.
- Sitemap and `hreflang` relationships.

## 9. Routing and Locale Middleware

Use ordered, composable strategies inspired by Paraglide while owning the implementation and configuration.

```ts
export default defineI18n({
  locales: ["en", "nl", "de"],
  baseLocale: "en",
  strategy: ["url", "cookie", "preferredLanguage", "baseLocale"]
});
```

Built-in strategies:

- URL path.
- Domain or subdomain.
- Cookie.
- Browser `navigator.languages`.
- `Accept-Language`.
- User/account preference.
- Request header.
- Base locale.
- Custom functions.

Routing requirements:

- Prefix all locales or omit the base-locale prefix.
- Translated static path segments.
- Database-backed localized slugs.
- Domain-to-locale mappings.
- Locale-preserving links and redirects.
- Localized URL generation and URL delocalization.
- Route-level strategy overrides.
- API/RPC/asset/internal route exclusions.
- Query-string and fragment preservation.
- SSR request isolation.
- Canonical locale redirects.
- `hreflang`, canonical, and localized sitemap generation.
- Localized 404 behavior and redirects after slug changes.

Build the core against web-standard `Request`, `Response`, `URL`, and `URLPattern` APIs. Add TanStack Start-specific helpers in its integration package.

## 10. Drizzle Localization

### 10.1 Recommended data model

Use companion translation tables rather than one column per locale.

```ts
export const posts = pgTable("posts", {
  id: uuid("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description")
});

export const postTranslations = pgTable("post_translations", {
  postId: uuid("post_id").references(() => posts.id).notNull(),
  locale: text("locale").notNull(),
  title: text("title"),
  description: text("description"),
  slug: text("slug"),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description")
});
```

Keep synchronization metadata in a normalized companion table so existing application tables are not polluted with revision columns for every localized field.

### 10.2 Explicit resource mapping

```ts
const databaseResources = defineDatabaseResources({
  posts: localizedResource({
    entity: posts,
    translations: postTranslations,
    id: posts.id,
    locale: postTranslations.locale,
    fields: {
      title: {
        source: posts.title,
        translation: postTranslations.title
      },
      slug: {
        source: posts.slug,
        translation: postTranslations.slug,
        kind: "route-slug"
      },
      seoTitle: {
        source: posts.seoTitle,
        translation: postTranslations.seoTitle,
        kind: "seo"
      }
    }
  })
});
```

Only mapped resources and fields are readable or writable through devtools, CLI, or MCP.

### 10.3 Required functionality

- Typed localized queries.
- Locale fallback selection.
- Missing and stale translation queries.
- Transactional single and batch updates.
- Optimistic concurrency.
- Source revision history.
- Draft, current, and reviewed metadata.
- Cache invalidation hooks.
- Localized slug lookup.
- Explicit field allowlists.
- No arbitrary SQL execution through any public tool.

Support JSON locale columns as an optional small-application strategy, not the recommended default.

## 11. MCP Server

The MCP server is a passive adapter over the same core used by the CLI and overlay. The connected agent decides when to call tools. The MCP server cannot wake, message, or push prompts to the agent.

### Initial tools

- `list_locales`
- `get_locale_configuration`
- `list_translation_stores`
- `search_messages`
- `get_message`
- `get_message_context`
- `get_translation_status`
- `get_localization_coverage`
- `find_missing_translations`
- `find_stale_translations`
- `find_orphaned_translations`
- `get_source_change`
- `get_source_history`
- `update_translation`
- `update_message_variants`
- `mark_translation_reviewed`
- `acknowledge_source_change`
- `update_base_message`
- `validate_translation`
- `get_page_content`
- `get_page_seo`
- `update_page_seo`
- `list_localized_routes`
- `update_localized_route`
- `list_database_resources`
- `get_database_localization_rows`
- `update_database_translation`
- `generate_localization_report`

### Safety rules

- Expose only configured stores and allowlisted database fields.
- Separate read and write capabilities.
- Require expected source revision/fingerprint on translation writes.
- Return a structured diff for every mutation.
- Provide dry-run support for batches.
- Use atomic file updates and database transactions.
- Validate variables, rich-text placeholders, and protected terminology before saving.
- Never expose arbitrary file access, arbitrary shell execution, or arbitrary SQL.
- Allow optional confirmation thresholds for large mutations.

## 12. CLI

Initial commands:

```text
i18n init
i18n dev
i18n generate
i18n extract
i18n reconcile
i18n typecheck
i18n status
i18n missing
i18n stale
i18n diff <message-id>
i18n validate
i18n coverage
i18n routes
i18n db scan
i18n compact
i18n import
i18n export
i18n mcp
```

Output formats:

- Human-readable terminal output.
- JSON for automation.
- CI annotations where supported.
- Markdown report for pull requests.

## 13. Validation and QA

Validate when TypeScript message modules are parsed, after source generation, during semantic TypeScript checking, on overlay saves, on MCP mutations, and in CI.

Initial checks:

- Invalid TypeScript syntax or unsupported native message-module shapes.
- Missing and empty translations.
- Stale translations.
- Unreconciled source changes.
- Variable equality and types.
- Required plural categories.
- ICU syntax.
- Rich-text placeholder integrity.
- HTML/XML tag balance where enabled.
- Length and character limits.
- Duplicate IDs.
- Invalid locales.
- Broken localized routes.
- Duplicate localized slugs.
- Missing SEO fields for configured production routes.
- Invalid database mappings.
- Orphaned translations.

Later checks:

- Glossary consistency.
- Spell checking.
- Pseudolocalization.
- Pseudo-RTL.
- Text-overflow detection.
- Screenshot-based visual regression.
- Automated language-quality assessment via optional agent workflows.

## 14. TanStack Start Reference Integration

The first end-to-end example must demonstrate:

- Locale middleware in SSR.
- Localized route helpers.
- Locale and namespace preloading in route lifecycle hooks.
- Request-local runtime context.
- Hydration without loading a locale twice.
- Floating development overlay.
- Visible message inspection.
- SEO and alt-text editing.
- Drizzle-backed product name, description, SEO fields, and localized slug.
- MCP tools operating on the same project.
- Production build with devtools metadata removed.

## 15. Interoperability

The native TypeScript module format is canonical. Initial adapters should support:

- Import from and export to Paraglide/inlang.
- Import from and export to i18next JSON.
- FormatJS/ICU JSON.
- Generic flat and nested JSON.

Later:

- YAML.
- XLIFF.
- PO/Gettext.
- Translation-memory exchange formats.
- CMS adapters.

Imports must preserve as much context as the source format exposes and clearly report metadata that cannot be represented.

## 16. Testing Strategy

### Unit tests

- Canonical message fingerprinting.
- Revision and stale-status derivation.
- Source reconciliation.
- TypeScript AST canonicalization and Compiler API source generation.
- TypeScript parse/update/print round trips for every supported message shape.
- ICU import parsing and conversion to native message-function ASTs.
- Type-level stale and missing translation assertions.
- Locale strategy ordering.
- URL localization and delocalization.
- Cache keys and invalidation.
- Drizzle mapping validation.
- MCP authorization boundaries.

### Golden tests

- Domain input to generated TypeScript module output.
- Deterministic Compiler API output across repeated generation runs.
- Import/export fixtures.
- Native module format-version compatibility.

### Integration tests

- TanStack Start SSR and hydration.
- Locale switching and route preservation.
- Locale/namespace chunk loading.
- Concurrent SSR requests with different locales.
- Overlay-to-TypeScript-AST update.
- Overlay-to-Drizzle transaction.
- MCP update with stale expected revision.

### Browser tests

- Element highlighting and selection.
- Original and target side-by-side editing.
- Source diff rendering.
- SEO and alt-text editing.
- Text overflow indication.
- Hot reload after TypeScript message-module changes.
- Production build contains no overlay or write metadata.

### Performance tests

- Bundle size per number of imported messages.
- Bundle growth as unused message-module size increases.
- Locale chunk size and cache behavior.
- Cold and incremental source-generation time.
- Runtime formatter cache effectiveness.
- Overlay impact in development.

## 17. Delivery Milestones

### Milestone 0: Foundation

- Set up monorepo, TypeScript, test runner, linting, and package builds.
- Define shared domain types.
- Define and version the native TypeScript module conventions.
- Implement parsing with `ts.createSourceFile`, generation with `ts.factory`, and deterministic emission with `ts.Printer`.
- Implement canonical message-AST formatting, semantic fingerprints, and contract fingerprints.
- Implement source/translation module writing, type-only metadata, reconciliation, and atomic byte-identical-write avoidance.
- Generate compile-time assertions for stale and missing translations.
- Add golden fixtures.

Exit criterion: a native TypeScript namespace can be parsed, changed, reconciled, typechecked, and written deterministically, and changing a source fingerprint makes an outdated translation fail semantic TypeScript checking.

### Milestone 1: Native message functions and runtime

- Generate direct typed ESM message functions with no CopyTranslater build-time compilation phase.
- Implement locale context and fallback.
- Implement cached `Intl` formatters.
- Add direct static-import mode.
- Add message-level tree-shaking fixture and bundle-size test.
- Add type-only development metadata and source-location hooks.

Exit criterion: an example application imports and renders generated TypeScript message functions directly, with no runtime catalog parsing and no CopyTranslater compiler in the application build.

### Milestone 2: Code splitting and TanStack Start

- Add locale splitting.
- Add locale-plus-namespace splitting.
- Build request-safe SSR middleware.
- Implement TanStack Start loaders and link helpers.
- Add hydration-state transfer.
- Add routing strategies and localized path patterns.

Exit criterion: the example ships only the active locale/route namespaces and handles concurrent localized SSR safely.

### Milestone 3: Development overlay

- Add Vite development bridge.
- Add floating button and inspection mode.
- Register rendered messages with DOM elements.
- Build side-by-side base/target editor.
- Add stale source diff, review, acknowledgement, and validation.
- Add page-level SEO and hidden-content editor.
- Add hot reload after writes.

Exit criterion: a developer can click visible text or hidden metadata, edit it, save it directly into the native TypeScript modules, and see the page update.

### Milestone 4: Drizzle

- Define translation metadata schema helpers.
- Implement explicit resource mappings.
- Implement reads, fallbacks, missing/stale queries, and transactions.
- Integrate database messages with the overlay.
- Add localized database slugs to routing.
- Add cache invalidation hooks.

Exit criterion: a configured database field can be inspected and translated from the page without exposing unrelated data.

### Milestone 5: MCP and CLI completion

- Expose read-only MCP inspection tools first.
- Add guarded single-message mutations.
- Add database and SEO tools.
- Add dry-run batch operations.
- Complete status, coverage, validation, report, and MCP CLI commands.
- Document the passive MCP interaction model.

Exit criterion: an existing MCP-capable agent can inspect context, find stale translations, and safely update configured stores.

### Milestone 6: Interoperability and hardening

- Add Paraglide, i18next, and FormatJS import/export.
- Add pseudolocales and stronger QA.
- Add type-only source-history compaction.
- Perform security review of write paths.
- Stabilize native module conventions and migration policy.
- Produce end-to-end documentation and source-module migration guides.

Exit criterion: a real project can migrate in, run in production, and upgrade native module format versions without data loss.

## 18. Versioning and Migration Policy

- Generated message modules contain a machine-readable, type-only `CopyTranslaterFormat` declaration.
- `i18n.config.ts` is validated through its exported TypeScript API and package types.
- The generator pins and tests its supported TypeScript Compiler API versions while emitting ordinary stable TypeScript syntax for consumers.
- Minor tool updates must preserve the current native module conventions.
- Convention changes require a deterministic TypeScript AST migration command.
- Migrations produce a preview diff and never silently discard unrecognized declarations.
- The generator and runtime follow package semantic versioning; native message modules remain ordinary application source and are migrated explicitly when their format version changes.

## 19. Initial Success Criteria

The first stable release is successful when it can demonstrate all of the following in one TanStack Start application:

1. Direct typed TypeScript message functions with no CopyTranslater application-build compilation phase.
2. Message-level tree-shaking.
3. Locale and namespace code splitting.
4. Immutable-cacheable locale chunks.
5. Ordered URL/cookie/browser/base locale resolution.
6. Localized paths and a database-backed localized slug.
7. A development overlay that shows the original and translation side by side.
8. Direct editing of visible text, SEO metadata, and image alt text.
9. Base-revision tracking with missing, stale, current, and reviewed states.
10. Safe Drizzle-backed translation updates.
11. MCP inspection and mutation through an already-running agent.
12. CLI and CI validation.
13. No authoring or editing metadata in the production bundle.

## 20. Decisions Already Made

- Use generated TypeScript modules as the canonical native storage format and application runtime source.
- Use the TypeScript Compiler API directly (`ts.createSourceFile`, `ts.factory`, and `ts.Printer`) for parsing, updates, and deterministic generation.
- Do not use JSON catalogs, SQLite catalogs, `ts-morph`, Babel, or a CopyTranslater compilation layer in the application build.
- Keep Paraglide as inspiration and an interoperability target, not the canonical store.
- Organize native message functions into locale and namespace TypeScript modules.
- Track source fingerprints, type-only source history, translation `BasedOn` fingerprints, reviews, and compile-time staleness assertions.
- Always show the original alongside the editable target in the overlay.
- Support SEO, alt text, accessibility text, routes, and Drizzle content as first-class localized data.
- Generate direct typed, tree-shakable, code-splittable, cacheable ESM functions and statically analyzable loaders.
- Use TanStack Start as the first reference integration.
- Keep MCP passive and rely on the user's existing agent to initiate tool calls.
- Keep database access explicitly mapped and allowlisted.
