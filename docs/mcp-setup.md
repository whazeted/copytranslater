# MCP setup

Install and build both `copytranslater` and `@copytranslater/mcp`. The server uses local stdio and must run with the application root as its working directory.

```json
{
  "mcpServers": {
    "copytranslater": {
      "command": "node",
      "args": ["/path/to/copytranslater/packages/copytranslater/dist/cli.js", "mcp"],
      "cwd": "/path/to/your/application"
    }
  }
}
```

The default is read-only. To allow guarded single-message changes, append `--write` to `args`. Check `get_project` after connecting: it reports the effective server and store capabilities. Tool annotations help clients present risk, but the server independently enforces the write boundary.

## Tools

| Tool | Behavior |
|---|---|
| `get_project` | Locales, policies, stores, and effective capabilities. |
| `search_messages` | Paginated text, locale, namespace, state, and diagnostic search. |
| `get_message` | Source/target functions, context, revisions, validation, and recoverable Git source change. |
| `update_message` | One guarded source or target update, optional review or stale-source acknowledgement. |
| `review_message` | Mark one current target reviewed. |
| `validate` | Validate the project, a filtered set, one message, or a proposed function without saving. |
| `get_report` | Coverage, state, locale, and diagnostic summaries. |

Every mutation requires the source fingerprint and the current target fingerprint returned by `get_message`; missing targets use `null`. A mismatch returns an actionable conflict instead of overwriting. Mutations return a structured before/after diff. Stale translations can retain their current target with `acknowledge_source=true`; missing translations need `function_text`. Review rejects missing and stale translations.

The server is passive: it cannot wake or prompt an agent, schedule background work, mutate batches, browse arbitrary files, run caller-provided shell commands, or access SQL. Responses are JSON in both text and structured MCP content. Search uses `limit` (maximum 100) and `offset`.

For a direct executable, use `node packages/mcp/dist/cli.js [--root /application] [--write]`. The read-only evaluation fixture can be served with:

```sh
node packages/mcp/dist/cli.js --root examples/tanstack-start-basic
```
