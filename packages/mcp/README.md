# @copytranslater/mcp

Passive local stdio MCP server for CopyTranslater. It exposes seven tools for project discovery, message search/detail, validation, coverage reporting, guarded single-message updates, and review.

```sh
copytranslater-mcp --root /path/to/application
copytranslater-mcp --root /path/to/application --write
```

The default is read-only. Write mode still requires current source and target fingerprints for every mutation and returns a structured before/after diff. The server exposes no arbitrary file, shell, SQL, scheduler, prompt, or batch-mutation capability.

Requires Node.js 22.12 or newer and the matching `copytranslater` package. See the full [MCP setup guide](https://github.com/whazeted/copytranslater/blob/main/docs/mcp-setup.md).
