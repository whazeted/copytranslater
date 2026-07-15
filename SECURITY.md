# Security model

CopyTranslater development tooling writes native TypeScript message modules. Production applications do not need the CLI, overlay bridge, TypeScript store, or MCP server.

## Boundaries

- Configuration is parsed as literal TypeScript syntax; it is never executed.
- Locales are valid BCP 47 tags. Namespace and message identifiers reject traversal, separators, NULs, and unsupported names.
- Reads and writes resolve only configured message modules. Existing real paths must remain beneath the real configured message root; symbolic file targets and locale-directory escapes are rejected.
- Message input passes the bounded parser, contract validation, empty-message checks, and `Intl` option construction before saving.
- MCP starts read-only. Write access requires explicit `--write`, and mutations remain single-message operations requiring source and target fingerprints.
- Project and per-file lock files serialize writers. Atomic replacement uses unique exclusive temporary files, flushes content, preserves the existing mode, compares expected bytes, and cleans up on errors.
- The Vite bridge is development-only, same-origin, JSON-only, and limited to 1 MB requests.
- MCP exposes no arbitrary file, network, shell, SQL, prompt, scheduler, or batch-mutation tool. Optional stale-source recovery invokes only fixed Git arguments with `execFile`, a timeout, bounded output, validated paths, and no shell.

## Review coverage

Automated tests cover slash and backslash traversal, invalid locales, Windows junction/Unix symlink escapes, stale source and target tokens, incompatible contracts, unsupported grammar, invalid formatter options, byte-identical avoidance, lock cleanup, direct-content conflicts, and concurrent writes to different messages in one file. The same suite and production build pass on native Windows and a clean Linux Node 22.12 environment. A production bundle assertion excludes the bridge endpoint, store identifier, overlay UI, authoring sentinel, and MCP server name.

The remaining filesystem race surface is direct hostile mutation by software that ignores CopyTranslater locks between path validation and the operating-system rename. Expected-content comparison prevents silent overwrite, and rename replaces the link entry rather than following it. Projects requiring protection against a hostile local user should use operating-system permissions and separate trust boundaries; this local developer tool is not a privilege boundary.

Report security issues privately to the project maintainers. Include the affected version, platform, reproduction, and whether untrusted local users share the workspace.
