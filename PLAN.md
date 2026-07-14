# CopyTranslater Implementation Plan

## 1. Vision

CopyTranslater is a local-first, open-source internationalization toolkit for web applications. It combines:

- A compiler that generates typed, tree-shakable, code-splittable message functions.
- A development overlay for editing visible text and hidden localized content in context.
- A versioned native catalog that tracks translation synchronization against a base locale.
- Ordered locale detection and localized routing inspired by Paraglide's middleware model.
- First-class localization of Drizzle-managed database content.
- A passive MCP server that lets an existing coding agent inspect and modify localization data using the user's existing agent/model subscription.

The tool must remain useful without an agent. Manual editing, compilation, validation, routing, and database localization are deterministic core features; MCP adds agent-driven automation on top.

## 2. Product Principles

1. **Local first**: no account, hosted service, or network connection is required for core functionality.
2. **Open and portable**: catalogs use documented schemas and can be imported from or exported to common ecosystems.
3. **Git friendly**: deterministic formatting, stable ordering, minimal generated churn, and mergeable files.
4. **Base locale as source of truth**: every translation records the base revision from which it was produced.
5. **Context at the point of editing**: translators can see the original, target, source change, page context, and metadata together.
6. **Safe writes**: every writable file, database resource, route, or metadata field is explicitly configured and validated.
7. **Fast production runtime**: authoring metadata stays out of production bundles.
8. **Framework-neutral core**: TanStack Start is the first reference integration, not a hard dependency of the storage or compiler layers.
9. **MCP is passive**: the server exposes tools and resources; it cannot initiate an agent turn or push a prompt to an agent.
10. **No unnecessary reinvention**: own the storage envelope and compiler while initially using ICU-compatible message grammar and platform `Intl` behavior.

## 3. Scope

### Initial scope

- TypeScript and modern JavaScript projects.
- TanStack Start reference integration.
- Visible UI messages, SEO metadata, accessibility text, image alt text, and localized routes.
- File-backed catalogs using the native CopyTranslater format.
- Drizzle-backed localized database fields.
- Development-only browser overlay.
- CLI, compiler, middleware, validation, and MCP server.
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
  catalog/              Native JSON catalog reader/writer and JSON Schemas
  compiler/             Typed ESM code generation
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

## 5. Native Storage Format

### 5.1 Files

```text
i18n/
  project.json
  routes.i18n.json
  catalogs/
    common.i18n.json
    checkout.i18n.json
    seo.i18n.json
  generated/
    runtime.ts
    messages/
    locales/
```

`generated/` may be committed or ignored. Generation must be deterministic either way.

### 5.2 Project manifest

```json
{
  "$schema": "https://copytranslater.dev/schema/project-v1.json",
  "version": 1,
  "sourceLocale": "en",
  "locales": ["en", "nl", "de"],
  "messageFormat": "icu-v1",
  "catalogs": ["./catalogs/*.i18n.json"],
  "routes": "./routes.i18n.json"
}
```

The manifest contains serializable project data. Runtime functions, database handles, custom locale strategies, and framework objects belong in `i18n.config.ts`.

### 5.3 Message-centric catalog

The catalog keeps a message's source, translations, synchronization data, and translator context together.

```json
{
  "$schema": "https://copytranslater.dev/schema/catalog-v1.json",
  "version": 1,
  "namespace": "checkout",
  "messages": {
    "completePurchase": {
      "source": {
        "value": "Complete your purchase",
        "revision": 7,
        "fingerprint": "sha256:2d5c..."
      },
      "sourceHistory": {
        "6": {
          "value": "Complete purchase",
          "fingerprint": "sha256:96af..."
        }
      },
      "translations": {
        "nl": {
          "value": "Rond je aankoop af",
          "sourceRevision": 6,
          "sourceFingerprint": "sha256:96af...",
          "reviewedRevision": 6
        }
      },
      "context": {
        "description": "Primary checkout submit button",
        "tags": ["checkout", "button"],
        "maxLength": 40,
        "sourceLocations": [
          {
            "file": "src/routes/checkout.tsx",
            "line": 42
          }
        ]
      }
    }
  }
}
```

### 5.4 Derived status

Do not persist a redundant status field. Derive it from the source and translation records:

- `missing`: target translation does not exist.
- `stale`: `sourceFingerprint` differs from the current base fingerprint.
- `reviewed`: translation points to the current source and `reviewedRevision` equals the current source revision.
- `current`: translation points to the current source but has not been reviewed.
- `orphaned`: translation remains after the source message is removed.
- `base-fallback`: runtime displays the source because the target is unavailable.
- `intentionally-unchanged`: translator explicitly acknowledges a source change without changing the target value.

Represent intentional acknowledgement explicitly rather than overloading review metadata.

### 5.5 Fingerprints

Create fingerprints from a canonical semantic message representation containing:

- Literal text.
- Variable names and types.
- Plural and select variants.
- Rich-text placeholders.
- Formatter configuration.

Exclude JSON formatting, property order, source line numbers, descriptions, screenshots, and tags. Track context separately with an optional `contextFingerprint` so context changes can produce warnings without making content stale.

### 5.6 Source history

- Retain every source revision referenced by an existing translation.
- Retain a configurable number of recent unreferenced revisions.
- Use Git as the complete audit history for file-backed catalogs.
- Provide a compaction command that removes old, unreferenced revisions.
- Avoid timestamps and usernames in Git-backed catalogs by default to reduce diff noise.

### 5.7 Direct manual edits

Developers must be able to edit catalog JSON without the overlay.

On `dev`, `build`, or `validate`:

1. Parse and canonicalize the source message.
2. Recalculate its fingerprint.
3. Detect a fingerprint mismatch without a revision change.
4. Report an unrecorded source change.
5. Allow `i18n reconcile` to create the next source revision and retain the previous source.

Development may offer safe automatic reconciliation with a visible notification. CI should reject unreconciled history changes.

## 6. Shared Domain and Store Model

All storage adapters implement a common logical model. File catalogs and Drizzle remain separate physical stores rather than duplicating database content into JSON.

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

- Native catalog files.
- Drizzle.
- In-memory test store.
- Read-only external adapter base class.

## 7. Compiler and Generated Runtime

### 7.1 Goals

- Typed message keys and parameters.
- Precompiled message functions with no production parsing.
- Message-level tree-shaking.
- Optional locale and namespace splitting.
- Deterministic output for build caching.
- Synchronous rendering after locale preload.
- Request-safe SSR.
- Development metadata excluded from production.

### 7.2 Generated layout

```text
i18n/generated/
  runtime.ts
  registry.ts
  messages/
    common.ts
    checkout.ts
  locales/
    en/
      common.ts
      checkout.ts
    nl/
      common.ts
      checkout.ts
```

Prefer named ESM exports for predictable tree-shaking:

```ts
import { completePurchase } from "~/i18n/generated/messages/checkout";

completePurchase();
```

### 7.3 Compilation modes

#### Bundled

Each imported function contains every locale's compiled result. Calls remain synchronous and messages are tree-shakable, but all locales for an imported message ship together.

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

This should become the recommended production mode after the basic compiler is stable.

### 7.4 Dynamic keys

Dynamic dictionary lookup prevents full message-level tree-shaking. Support it only through an explicit generated registry. Enabling dynamic access for a namespace opts that namespace out of granular tree-shaking.

### 7.5 Caching

Implement distinct cache layers:

- **Compiler cache**: fingerprint catalogs and options; regenerate only changed namespaces.
- **Build cache**: do not rewrite byte-identical generated files.
- **Browser/CDN cache**: use content-hashed immutable locale chunks.
- **Formatter cache**: reuse `Intl` formatter instances by locale and options.
- **Server module cache**: reuse compiled modules while keeping active locale request-scoped.
- **Database cache interface**: permit memory, Redis, KV, or application-defined caches with resource/row/field/locale invalidation tags.

### 7.6 Production stripping

Production output must omit:

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
i18n compile
i18n extract
i18n reconcile
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

Validate at catalog parse time, compile time, overlay save time, MCP mutation time, and CI time.

Initial checks:

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

The native format is canonical. Initial adapters should support:

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
- ICU parsing and compilation.
- Locale strategy ordering.
- URL localization and delocalization.
- Cache keys and invalidation.
- Drizzle mapping validation.
- MCP authorization boundaries.

### Golden tests

- Catalog input to generated ESM output.
- Deterministic output across repeated builds.
- Import/export fixtures.
- JSON Schema compatibility.

### Integration tests

- TanStack Start SSR and hydration.
- Locale switching and route preservation.
- Locale/namespace chunk loading.
- Concurrent SSR requests with different locales.
- Overlay-to-file update.
- Overlay-to-Drizzle transaction.
- MCP update with stale expected revision.

### Browser tests

- Element highlighting and selection.
- Original and target side-by-side editing.
- Source diff rendering.
- SEO and alt-text editing.
- Text overflow indication.
- Hot reload after catalog changes.
- Production build contains no overlay or write metadata.

### Performance tests

- Bundle size per number of imported messages.
- Bundle growth as unused catalog size increases.
- Locale chunk size and cache behavior.
- Cold and incremental compile time.
- Runtime formatter cache effectiveness.
- Overlay impact in development.

## 17. Delivery Milestones

### Milestone 0: Foundation

- Set up monorepo, TypeScript, test runner, linting, and package builds.
- Define shared domain types.
- Publish versioned JSON Schemas locally.
- Implement canonical formatting and fingerprints.
- Implement native catalog parsing, writing, and reconciliation.
- Add golden fixtures.

Exit criterion: a catalog can be parsed, changed, reconciled, validated, and written deterministically.

### Milestone 1: Compiler and runtime

- Compile ICU messages into typed ESM functions.
- Implement locale context and fallback.
- Implement cached `Intl` formatters.
- Add bundled compilation mode.
- Add message-level tree-shaking fixture and bundle-size test.
- Add source maps and development metadata hooks.

Exit criterion: an example application renders typed compiled messages with no runtime catalog parsing.

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

Exit criterion: a developer can click visible text or hidden metadata, edit it, save it to the native catalog, and see the page update.

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
- Add catalog compaction.
- Perform security review of write paths.
- Stabilize schemas and migration policy.
- Produce end-to-end documentation and migration guides.

Exit criterion: a real project can migrate in, run in production, and upgrade catalog versions without data loss.

## 18. Versioning and Migration Policy

- Catalog and project files have explicit integer schema versions.
- JSON Schemas are published and bundled with the CLI.
- Minor tool updates must preserve the current schema.
- Schema changes require a deterministic migration command.
- Migrations produce a preview diff and never silently discard unknown fields.
- Generated runtime output follows package semantic versioning but is always reproducible from canonical catalogs.

## 19. Initial Success Criteria

The first stable release is successful when it can demonstrate all of the following in one TanStack Start application:

1. Typed and precompiled message functions.
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

- Use a native CopyTranslater storage format.
- Keep Paraglide as inspiration and an interoperability target, not the canonical store.
- Use a message-centric catalog organized into namespace files.
- Track base revisions, fingerprints, source history, translation source revisions, and reviews.
- Always show the original alongside the editable target in the overlay.
- Support SEO, alt text, accessibility text, routes, and Drizzle content as first-class localized data.
- Generate typed, tree-shakable, code-splittable, cacheable ESM functions.
- Use TanStack Start as the first reference integration.
- Keep MCP passive and rely on the user's existing agent to initiate tool calls.
- Keep database access explicitly mapped and allowlisted.
