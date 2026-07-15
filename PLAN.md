# CopyTranslater Implementation Plan

## 1. Vision

CopyTranslater is a local-first, open-source internationalization toolkit for TypeScript web applications. Its first release combines four capabilities:

- Native, typed TypeScript message modules that are committed with the application.
- Deterministic generation and validation based on semantic source revisions.
- A TanStack Start development overlay for editing visible messages in context.
- A passive MCP server through which an existing coding agent can inspect and update messages.

The deterministic toolchain remains fully useful without an agent. MCP adds automation but never initiates agent work, executes arbitrary code, or bypasses configured write boundaries.

## 2. Product Principles

1. **Local first**: core functionality requires no account, hosted service, or network connection.
2. **Git friendly**: generation is deterministic, ordering is stable, and byte-identical files are not rewritten.
3. **Type safe**: TypeScript checks message parameters and return contracts.
4. **Revision aware**: translations record the semantic source revision on which they are based.
5. **Contextual**: translators can edit a visible message alongside its source value and metadata.
6. **Safe by configuration**: writable files, stores, routes, and fields are explicitly allowlisted.
7. **Small production runtime**: authoring metadata and editing code stay out of production bundles.
8. **Framework-neutral core**: TanStack Start is the first integration, not a core dependency.
9. **Passive MCP**: the server responds to tools and resources but cannot wake or prompt an agent.
10. **Focused first release**: advanced routing, database localization, broad interchange, and hidden-content editing follow the initial vertical slice.

## 3. Scope

### Version 1

- TypeScript-capable web build pipelines.
- Native TypeScript source and translation modules.
- Literal messages, typed interpolation, plurals, selects, and locale-aware formatting.
- Semantic source fingerprints and `BasedOn` translation fingerprints.
- Four translation workflow states: missing, stale, current, and reviewed.
- CLI synchronization, validation, reporting, import, export, and MCP startup.
- Static message imports and locale-plus-namespace dynamic loading.
- URL-prefix locale routing with cookie, `Accept-Language`, and base-locale fallback.
- TanStack Start SSR, hydration, links, Vite development bridge, and a visible-text overlay.
- Passive MCP inspection and guarded single-message updates.

### Explicit version 1 non-goals

- JSON and ICU-compatible import/export through the CLI.
- Hosted translation management, billing, identity management, or a marketplace.
- Autonomous or background MCP work.
- Arbitrary filesystem, shell, SQL, or database access.
- Arbitrary TypeScript inside message function bodies.
- Domain routing, translated path segments, database-backed slugs, or route-level strategy overrides.
- Drizzle-backed localization.
- SEO, social metadata, accessibility attributes, localized assets, and page-wide hidden-content editing.
- Embedded source-history retention or compaction.
- Paraglide, i18next, XLIFF, PO, YAML, CMS, or translation-memory adapters.
- A standalone documentation website.
- Mobile-native SDKs.

These are post-v1 extensions, not requirements for proving the core architecture.

## 4. Repository Layout

Start with a small monorepo and split packages only after their APIs have independent consumers:

```text
packages/
  copytranslater/       Domain model, parser, generator, stores, validation, CLI
  runtime/              Message helpers, locale context, formatters, loaders
  tanstack-start/       TanStack helpers, Vite bridge, development overlay
  mcp/                  Passive MCP server
examples/
  tanstack-start-basic/
docs/
```

The `copytranslater` package owns development-time behavior. The production application needs only `runtime` and its framework integration. Drizzle, additional framework integrations, and import/export adapters become separate packages when implemented after v1.

## 5. Native TypeScript Message Format

### 5.1 Project files

```text
i18n.config.ts
i18n/
  messages/
    en/
      common.ts
      checkout.ts
    nl/
      common.ts
      checkout.ts
  loaders.ts
  runtime.ts
```

Files under `i18n/messages/` are committed application source, not disposable build output.

### 5.2 Configuration

Use `sourceLocale` consistently throughout configuration and APIs:

```ts
export default defineI18n({
  sourceLocale: "en",
  locales: ["en", "nl", "de"],
  messages: "./i18n/messages",
  routing: {
    prefix: "all-except-source",
    strategy: ["url", "cookie", "acceptLanguage", "sourceLocale"],
  },
  staleTranslations: "error",
  missingTranslations: "error",
});
```

There is no separate project manifest.

### 5.3 Supported function grammar

Version 1 accepts only a documented, generated subset of TypeScript expressions:

- Literal-returning functions.
- Template literals containing declared parameters.
- Calls to CopyTranslater's `plural`, `select`, and formatter helpers.
- Nested combinations of those helpers.

The parser rejects arbitrary calls, statements, control flow, property access, side effects, and unsupported expressions. This bounded grammar makes direct edits deterministic and safe to canonicalize. Later format versions may add constructs through explicit migrations.

### 5.4 Source modules

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
    maxLength: 40;
  };
}

export const completePurchase = () => "Complete your purchase";

export const basketItems = ({ count }: { count: number }) =>
  plural(count, {
    one: () => "1 item",
    other: () => `${count} items`,
  });
```

Message bodies are the canonical semantic representation. Type-only revision and context declarations disappear from emitted JavaScript.

### 5.5 Translation modules

```ts
import type * as Source from "../en/checkout";
import { plural } from "@copytranslater/runtime";

export type CopyTranslaterFormat = 1;

export interface BasedOn {
  completePurchase: "sha256:2d5c...";
  basketItems: "sha256:91ab...";
}

export interface Reviewed {
  completePurchase: "sha256:2d5c...";
}

export const completePurchase =
  (() => "Rond je aankoop af") satisfies typeof Source.completePurchase;

export const basketItems =
  (({ count }) => plural(count, {
    one: () => "1 artikel",
    other: () => `${count} artikelen`,
  })) satisfies typeof Source.basketItems;
```

TypeScript's `satisfies` operator enforces message parameter contracts. Missing and stale translations are semantic workflow conditions and are reported by `i18n check`, not by intentionally failing TypeScript aliases. This keeps editor and compiler errors focused on actual type incompatibilities.

Projects enforce both layers in CI:

```json
{
  "scripts": {
    "check": "tsc --noEmit && i18n check"
  }
}
```

Policies apply to `i18n check`:

- `error`: exit nonzero and emit a CI annotation.
- `warning`: report the condition without failing.
- `allow`: retain the derived state without reporting it.

### 5.6 Translation state

Expose only four workflow states:

- `missing`: the target has no corresponding export.
- `stale`: `BasedOn` differs from the current source fingerprint.
- `reviewed`: `Reviewed`, `BasedOn`, and the current source fingerprint are equal.
- `current`: `BasedOn` matches the current source fingerprint but `Reviewed` does not.

Other conditions are not workflow states:

- An incompatible function contract or message shape is a validation error.
- An export without a source message is an orphan diagnostic.
- Rendering the source when a target is unavailable is fallback behavior.
- A translation intentionally identical to its source is current once `BasedOn` advances.

### 5.7 Semantic fingerprints

Create fingerprints from a canonical message AST containing:

- Literal text.
- Variable names and types.
- Plural and select variants.
- Formatter configuration.

Exclude formatting, declaration order, source locations, descriptions, and tags. Track context separately so context changes can warn without making content stale.

Maintain an internal contract fingerprint to distinguish wording changes from incompatible parameter, plural, select, or formatter changes.

### 5.8 Updates and history

Use the TypeScript Compiler API for all native-module reads and writes:

- Parse with `ts.createSourceFile`.
- Create declarations with `ts.factory`.
- Emit with `ts.Printer` using a pinned supported TypeScript version.
- Write atomically and skip byte-identical output.
- Preserve supported direct edits after parsing and canonicalization.
- Reject unsupported declarations instead of silently rewriting them.

`i18n sync` replaces separate generate, extract, and reconcile workflows. It parses supported message functions, recalculates fingerprints, previews changes, and updates revision declarations. CI runs `i18n check` in read-only mode and rejects unsynchronized source changes.

Git is the version 1 audit history. When available, development tools may recover the source value matching an old fingerprint from Git to display a stale diff. If it cannot be recovered, the UI still reports staleness without the historical text. Embedded `SourceHistory` declarations, retention settings, and compaction are deferred.

## 6. Runtime and Bundling

### 6.1 Static imports

Applications can import individual message functions directly:

```ts
import { completePurchase } from "~/i18n/messages/nl/checkout";

completePurchase();
```

This mode supports ordinary named-export tree-shaking. Bundle tests verify that unused exports do not increase the entry chunk.

### 6.2 Locale and namespace loading

Runtime-selected locales use statically analyzable dynamic imports:

```ts
const checkoutLoaders = {
  en: () => import("./messages/en/checkout"),
  nl: () => import("./messages/nl/checkout"),
  de: () => import("./messages/de/checkout"),
} as const;
```

Framework loaders preload the active locale and route namespaces before rendering. Message calls are synchronous after preload.

Dynamic loading guarantees locale-plus-namespace chunking, not message-level elimination inside every dynamically imported namespace. Namespace size is therefore an intentional granularity choice. Dynamic dictionary access is not part of v1.

### 6.3 Runtime requirements

- Request-scoped locale state for SSR.
- Locale fallback to the configured source locale.
- Cached `Intl` formatters keyed by locale and options.
- Hydration without loading the same namespace twice.
- Content-hashed, immutable-cacheable locale chunks in production.
- No production catalog parsing or CopyTranslater compilation phase.

### 6.4 Production stripping

TypeScript erases revision, review, and context interfaces. Production integration must also exclude:

- The overlay and development bridge.
- Editing endpoints and write capabilities.
- Source locations, descriptions, and screenshots.
- MCP registration.

A production bundle test verifies these exclusions rather than relying on convention alone.

## 7. Shared Domain and Store Model

The overlay, CLI, and MCP use one logical store contract:

```ts
interface LocalizationStore {
  id: string;
  capabilities: {
    read: boolean;
    write: boolean;
    batch?: boolean;
    transactions?: boolean;
  };

  getMessage(ref: MessageRef): Promise<LocalizedMessage>;
  updateMessage(input: UpdateMessageInput): Promise<UpdateResult>;
  listMessages(query: MessageQuery): Promise<LocalizedMessage[]>;
}
```

Queries filter by locale, namespace, workflow state, and diagnostic type. Updates require the expected source fingerprint and return a structured diff. Version 1 includes a TypeScript-module store and an in-memory test store.

## 8. TanStack Start and Development Overlay

### 8.1 Version 1 integration

- Request-safe locale middleware.
- Locale-preserving links and redirects.
- Route-level locale and namespace preload.
- Hydration-state transfer.
- Development-only Vite write endpoint and hot reload.
- A floating development button and inspection mode.

### 8.2 Version 1 overlay

The first overlay supports visible messages registered through the TanStack integration:

- Highlight a registered localized element on hover.
- Select it to resolve the message ID and source location.
- Show source and target values side by side.
- Show missing, stale, current, or reviewed state.
- Validate parameters, plurals, selects, and length metadata.
- Save, save and review, revert, copy source, and advance `BasedOn`.
- Preview the number of translations made stale by a source edit.
- Trigger hot reload after an atomic module update.

The integration uses explicit development instrumentation. It does not promise to infer arbitrary server, client, or database text from the DOM.

SEO, social metadata, accessibility attributes, alt text, localized assets, routes, and database fields are post-v1 overlay tabs built on the same store contract.

## 9. Routing

Version 1 resolves locales in this order:

1. URL prefix.
2. Configured cookie.
3. `Accept-Language` on the server or `navigator.languages` on the client.
4. Source locale.

Version 1 routing supports:

- Prefixing every locale or omitting the source-locale prefix.
- Locale-preserving links and redirects.
- Query-string and fragment preservation.
- Asset, API, RPC, and internal-route exclusions.
- Canonical locale redirects.
- SSR request isolation.
- Localized 404 fallback.

Build the core against web-standard `Request`, `Response`, and `URL`. Do not require `URLPattern` for the initial implementation.

Domain mappings, translated static segments, account preferences, custom strategies, database slugs, route overrides, `hreflang`, and localized sitemap generation are post-v1.

## 10. CLI

Version 1 commands:

```text
i18n init
i18n dev
i18n sync
i18n check [--state missing|stale] [--format human|json|ci|markdown]
i18n status [--locale <locale>] [--namespace <namespace>]
i18n import --format json|icu
i18n export --format json|icu
i18n mcp
```

`check` handles syntax, synchronization, missing and stale policies, contracts, message validation, and coverage reporting. `status` is the exploratory read-only view. Adding a new top-level command requires behavior that cannot be expressed clearly by one of these commands or its flags.

## 11. MCP Server

The passive MCP server exposes a small composable surface over the same store used by the CLI and overlay:

- `get_project`: locales, configuration, stores, and capabilities.
- `search_messages`: filters by text, locale, namespace, workflow state, or diagnostic.
- `get_message`: value, source, context, revision data, validation, and recoverable source change.
- `update_message`: guarded target or source update with optional review or source acknowledgement.
- `review_message`: mark a current translation reviewed.
- `validate`: validate one message, a filtered set, or the project.
- `get_report`: coverage and diagnostic summary for a filtered set.

The API can add page, route, database, SEO, and batch tools when those stores are implemented after v1. Do not create separate tools when a filter or action on the existing model is sufficient.

### Safety rules

- Expose only configured stores and paths.
- Separate read and write capabilities.
- Require an expected source fingerprint for writes.
- Return a structured diff for every mutation.
- Validate the supported grammar, variables, and formatter placeholders before saving.
- Use atomic file updates.
- Never expose arbitrary files, shell execution, or SQL.
- Keep batch mutation out of v1.

## 12. Validation and Security

`i18n check`, overlay saves, and MCP writes share the same validators:

- Invalid TypeScript syntax or unsupported message expressions.
- Unsynchronized source fingerprints.
- Missing, empty, stale, and orphaned translations.
- Parameter and type-contract mismatches.
- Invalid plural or select variants.
- Invalid formatter arguments.
- Duplicate IDs and invalid locales.
- Unsafe or unconfigured write targets.

Only TypeScript contract failures are reported by `tsc`; workflow and localization diagnostics are reported by `i18n check` according to project policy.

Later validators may add rich-text integrity, terminology, spelling, pseudolocalization, pseudo-RTL, overflow detection, screenshots, and agent-assisted language assessment.

## 13. Testing Strategy

### Unit and golden tests

- Supported grammar parsing and rejection.
- Canonical AST formatting and semantic fingerprints.
- State and diagnostic derivation.
- TypeScript parse/update/print round trips.
- Atomic, byte-identical-write avoidance.
- Stable output across repeated runs on the pinned TypeScript version.
- JSON and ICU import/export fixtures.
- Locale strategy ordering and URL transforms.
- Store authorization and optimistic concurrency.

### Integration tests

- `tsc --noEmit` catches function-contract errors.
- `i18n check` catches missing, stale, orphaned, and unsynchronized messages.
- TanStack Start SSR handles concurrent requests with different locales.
- Hydration reuses preloaded locale namespaces.
- The overlay updates a TypeScript module and triggers hot reload.
- MCP rejects a stale expected fingerprint and returns a structured diff on success.

### Browser and bundle tests

- Element highlighting, selection, editing, review, and source-change acknowledgement.
- Locale switching and query/fragment preservation.
- Static-import message tree-shaking.
- Dynamic locale-plus-namespace chunking.
- Production bundles omit overlay, write endpoints, MCP code, and authoring metadata.

## 14. Delivery Milestones

### Milestone 0: Native vertical slice

- Set up the four-package monorepo and example.
- Define the bounded message grammar and format version.
- Implement TypeScript parsing, generation, fingerprints, atomic writes, and the TypeScript-module store.
- Implement `init`, `sync`, `check`, and `status`.
- Implement runtime helpers, static imports, and locale-plus-namespace loaders.
- Add contract, golden, tree-shaking, and chunking tests.

Exit criterion: the example can synchronize, validate, typecheck, bundle, and render source and target messages without runtime catalog parsing or a CopyTranslater build compiler.

### Milestone 1: TanStack Start and visible-text overlay

- Implement URL/cookie/language locale resolution and SSR isolation.
- Add preload, hydration, link, and redirect helpers.
- Add the Vite development bridge and explicit message instrumentation.
- Implement visible-message selection, side-by-side editing, review, validation, and hot reload.
- Verify production stripping.

Exit criterion: a developer can click a visible message, edit its translation in the native TypeScript module, and see the localized page update safely.

### Milestone 2: Passive MCP and release hardening

- Implement the seven MCP tools and capability boundaries.
- Add guarded single-message writes and optimistic concurrency.
- Complete JSON and ICU import/export.
- Perform write-path security review and cross-platform testing.
- Publish a concise README, quick start, format specification, integration guide, and MCP setup guide.

Exit criterion: a new project can adopt the tool, use it manually or through an existing MCP-capable agent, and ship a production build without authoring code.

## 15. Post-v1 Extensions

Post-v1 work is prioritized by evidence from real integrations rather than being required for the first stable release.

### Drizzle localization

Use companion translation tables and explicit resource mappings. The schema and mapping must reference the same fields:

```ts
export const posts = pgTable("posts", {
  id: uuid("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  slug: text("slug").notNull(),
  seoTitle: text("seo_title"),
});

export const postTranslations = pgTable("post_translations", {
  postId: uuid("post_id").references(() => posts.id).notNull(),
  locale: text("locale").notNull(),
  title: text("title"),
  description: text("description"),
  slug: text("slug"),
  seoTitle: text("seo_title"),
});
```

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
        translation: postTranslations.title,
      },
      slug: {
        source: posts.slug,
        translation: postTranslations.slug,
        kind: "route-slug",
      },
      seoTitle: {
        source: posts.seoTitle,
        translation: postTranslations.seoTitle,
        kind: "seo",
      },
    },
  }),
});
```

The adapter will provide typed reads, fallback, missing/stale queries, transactional writes, optimistic concurrency, explicit field allowlists, localized slug lookup, and cache invalidation. It will never expose arbitrary SQL. Implement and document PostgreSQL first before generalizing to other Drizzle dialects.

### Advanced authoring and routing

- SEO, social, accessibility, alt text, assets, and structured-data fields.
- Rich-text placeholders and page-wide diagnostics.
- Translated paths, localized database slugs, domains, route overrides, `hreflang`, and sitemaps.
- Batch operations with dry-run and confirmation thresholds.

### Interoperability and QA

- Paraglide/inlang, i18next, FormatJS, YAML, XLIFF, and PO adapters.
- Pseudolocalization, pseudo-RTL, terminology, spelling, overflow, and screenshot validation.
- Optional embedded source history only if Git recovery proves insufficient.

### Documentation website

Build and deploy a GitHub Pages website after the README and reference documentation have stabilized. Website automation, screenshots, versioned docs, and custom-domain configuration are release infrastructure rather than core product exit criteria.

## 16. Versioning and Migration

- Generated modules contain a type-only `CopyTranslaterFormat` declaration.
- The tool pins and tests supported TypeScript Compiler API versions while emitting ordinary TypeScript syntax.
- Patch and minor releases preserve the current native conventions.
- Convention changes require a deterministic AST migration with a preview diff.
- Migrations never discard unrecognized declarations silently.
- Runtime and tool packages follow semantic versioning.

## 17. Version 1 Success Criteria

The first stable release succeeds when one TanStack Start application demonstrates:

1. Typed native TypeScript messages with a bounded, documented grammar.
2. `satisfies`-based parameter contracts plus policy-driven `i18n check` validation.
3. Semantic source fingerprints and missing, stale, current, and reviewed states.
4. Static-import message tree-shaking and dynamic locale-plus-namespace chunks as separate guarantees.
5. URL, cookie, language, and source-locale resolution with request-safe SSR.
6. A visible-text overlay that edits native modules and hot reloads the page.
7. Guarded passive MCP inspection and single-message mutation.
8. Deterministic atomic writes and clean Git diffs.
9. No overlay, write endpoint, MCP, or authoring metadata in production bundles.
10. A new user can install the tool and run the example from the README.
