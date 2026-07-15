# Quick start

CopyTranslater requires Node.js 22.12 or newer. From this repository:

```sh
npm install
npm run check
npm run build
```

Create a project from its application root:

```sh
node /path/to/copytranslater/packages/copytranslater/dist/cli.js init
node /path/to/copytranslater/packages/copytranslater/dist/cli.js sync
node /path/to/copytranslater/packages/copytranslater/dist/cli.js check
```

`init` creates an `en`/`nl` example without replacing existing files. Edit the source module, run `sync`, then translate the corresponding target functions. `check` validates syntax, source revisions, contracts, workflow state, empty messages, and project policy.

Explore or exchange translations:

```sh
i18n status --locale nl
i18n export --format json --output translations.json
i18n import --format json --input translations.json
i18n export --format icu --locale nl --namespace common --output nl-common.json
i18n import --format icu --locale nl --namespace common --input nl-common.json
```

Start the TanStack Start example with `npm run example`, open the shown URL, and visit `/nl` or `/de` to see locale middleware, namespace preload, and localized SSR. Choose **Inspect messages** for visible-text editing. For an agent integration, continue with the [MCP setup guide](./mcp-setup.md). Production applications import only runtime and framework packages; the overlay, write bridge, CLI, and MCP package are development dependencies.
