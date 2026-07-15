# copytranslater

Local-first TypeScript internationalization tooling. It parses a bounded native message grammar, maintains semantic source revisions, validates translation workflow state, performs deterministic atomic writes, and imports or exports CopyTranslater JSON and ICU MessageFormat bundles.

```sh
i18n init
i18n sync
i18n check
i18n status --locale nl
i18n export --format json --output translations.json
```

Requires Node.js 22.12 or newer. See the [project quick start](https://github.com/whazeted/copytranslater/blob/main/docs/quick-start.md), [format specification](https://github.com/whazeted/copytranslater/blob/main/docs/format-specification.md), and [security model](https://github.com/whazeted/copytranslater/blob/main/SECURITY.md).
