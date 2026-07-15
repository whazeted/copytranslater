# Native format and interchange specification

## Project configuration

`i18n.config.ts` exports a literal configuration object, optionally wrapped in `defineI18n`. Version 1 recognizes `sourceLocale`, `locales`, `messages`, `staleTranslations`, and `missingTranslations`. Locales must be unique valid BCP 47 language tags, and the source locale must be included.

Messages live at `<messages>/<locale>/<namespace>.ts`. Version 1 namespaces are flat safe file names. Message IDs are JavaScript identifiers.

## Native TypeScript modules

Every module may declare `CopyTranslaterFormat = 1`. Source modules use `SourceRevisions`; targets use `BasedOn` and `Reviewed`. These interfaces contain message IDs whose values are SHA-256 semantic fingerprints. Optional `MessageContext` fields contain only string, number, or boolean literal metadata.

Messages are named exported functions. The bounded body grammar accepts:

- string and template literals using declared parameters;
- `plural` and `select` with literal variants and a required `other` branch;
- `formatNumber`, `formatDateTime`, and `formatList` with literal option objects;
- nested combinations of those expressions and zero-argument variant callbacks.

Statements, side effects, arbitrary calls, property access, spreads, computed properties, undeclared identifiers, duplicate keys, nonliteral formatter options, and invalid `Intl` options are rejected.

Semantic fingerprints ignore formatting and comments but change with message meaning. Contract fingerprints ignore wording while preserving parameters, placeholders, helper structure, and variants. A target is `missing`, `stale`, `current`, or `reviewed` according to its function, `BasedOn`, and `Reviewed` entries.

## CopyTranslater JSON

`i18n export --format json` emits one deterministic document:

```json
{
  "format": "copytranslater-json",
  "version": 1,
  "sourceLocale": "en",
  "messages": [
    {
      "locale": "nl",
      "namespace": "common",
      "id": "greeting",
      "state": "current",
      "sourceFingerprint": "sha256:...",
      "targetFingerprint": "sha256:...",
      "functionText": "({ name }) => `Hallo, ${name}!`",
      "reviewed": false
    }
  ]
}
```

JSON is the lossless interchange for the complete native grammar. Import validates the document and every message before writing. It requires the captured source and target fingerprints, rejects duplicates and source-locale entries, preserves review state, and updates one message at a time through the shared store.

## ICU MessageFormat

ICU commands operate on one locale and namespace and read or write a flat JSON object of message IDs to ICU MessageFormat strings:

```json
{
  "greeting": "Hallo, {name}!",
  "items": "{count, plural, one {One item} other {{count} items}}"
}
```

The adapter supports literal text, arguments, cardinal plurals, selects, number formatting, and date/time formatting. Import accepts named styles and parseable number/date skeletons when their options map to native literal `Intl` options. Export emits portable unstyled values plus percent, integer, currency, `dateStyle`, and `timeStyle` forms. It rejects rich-text tags, plural offsets, ordinal and exact-number selectors, unknown parameters, and structures that change the source contract.

ICU MessageFormat 1 has no portable list element, so messages using `formatList` must use CopyTranslater JSON. Native formatter option objects that cannot be represented losslessly as ICU syntax are also rejected with an instruction to use JSON. Rejection is intentional; interchange never silently discards behavior.

## Writes and ordering

Generated interfaces and interchange entries are sorted. Files use LF output, are skipped when byte-identical, and are replaced atomically. A project lock serializes compliant writers; a per-file lock and expected-content comparison detect direct concurrent edits. Temporary and lock files are removed on success and failure, with stale lock recovery after 60 seconds.
