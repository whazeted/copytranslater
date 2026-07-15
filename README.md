# CopyTranslater

CopyTranslater is a local-first internationalization toolkit for TypeScript applications. This repository currently implements the plan's Milestone 0 native vertical slice: typed TypeScript message modules, semantic source revisions, deterministic synchronization and validation, a guarded module store, runtime helpers, and locale-plus-namespace loading.

## Try the slice

Requires Node.js 20.19 or newer.

```sh
npm install
npm run check
npm run build
npm run example
```

The example is served by Vite and demonstrates both direct named imports and runtime locale/namespace loading. The TanStack Start middleware and editing overlay remain Milestone 1 work; the passive MCP server remains Milestone 2 work, as specified in [PLAN.md](./PLAN.md).

## Start a project

Build this workspace, then run the CLI from the application root:

```sh
node /path/to/copytranslater/packages/copytranslater/dist/cli.js init
node /path/to/copytranslater/packages/copytranslater/dist/cli.js sync
node /path/to/copytranslater/packages/copytranslater/dist/cli.js check
node /path/to/copytranslater/packages/copytranslater/dist/cli.js status --locale nl
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
- `packages/tanstack-start`: reserved Milestone 1 integration boundary.
- `packages/mcp`: reserved Milestone 2 passive-server boundary.
- `examples/tanstack-start-basic`: the native browser/bundle vertical slice that will receive the TanStack integration next.

The test suite covers grammar acceptance/rejection, semantic and contract fingerprints, atomic write avoidance, state derivation, optimistic concurrency, compile-time `satisfies` contracts, static-import tree-shaking, and dynamic locale chunking.
