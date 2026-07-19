# eslint-plugin-template

> A modern, TypeScript-first template for building ESLint plugins (Flat Config
> ready)

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]

This repository is a starter template for creating your own ESLint plugin with:

- ESLint 9 Flat Config support out of the box
- TypeScript with strong typing for rules and options
- Vitest-based rule tests via eslint-vitest-rule-tester
- Rule scaffolding script to generate rule code, tests, and docs
- Auto-generated README rules section via eslint-doc-generator

Use it as a “Use this template” on GitHub or fork and rename.

## Quick start

1. Create your repo from this template

- Click “Use this template” on GitHub, or
- Degit locally: `degit christopher-buss/eslint-plugin-template my-plugin`

2. Install dependencies

```pwsh
pnpm i
```

3. Rename the package and plugin

Update these fields to your plugin name (e.g., `eslint-plugin-awesome`):

- `package.json` → `name`, `description`, `repository`, `author`, `license`
- README title and badges

The runtime plugin name (used in config) is derived from the package name by
removing the `eslint-plugin-` prefix. For `eslint-plugin-awesome` the plugin key
becomes `awesome`.

4. Scaffold your first rule

```pwsh
pnpm create-rule my-new-rule
```

This generates:

- `src/rules/my-new-rule/rule.ts` – rule implementation
- `src/rules/my-new-rule/rule.spec.ts` – tests
- `src/rules/my-new-rule/documentation.md` – rule docs

5. Run tests and docs

```pwsh
pnpm test
pnpm eslint-docs
```

The docs command updates the auto-generated rules list in this README.

## Using your plugin

Once published to npm as `eslint-plugin-awesome`, you can enable it in a
project.

### Flat Config (ESLint 9+)

```js
// eslint.config.js / eslint.config.mjs / eslint.config.ts
import yourPlugin from "eslint-plugin-awesome";

export default [
	// Enable all recommended rules from your plugin
	yourPlugin.configs.recommended,

	// Or wire it manually
	{
		plugins: {
			awesome: yourPlugin,
		},
		rules: {
			"awesome/my-new-rule": "error",
		},
	},
];
```

### Legacy Config (.eslintrc)

```json
{
	"extends": ["plugin:yourname/recommended"]
}
```

### oxlint (via jsPlugins)

The non-type-aware rules are also published as an
[oxlint JS plugin](https://oxc.rs/docs/guide/usage/linter/writing-js-plugins) at
the `eslint-plugin-awesome/oxlint` entry point, so the same rules run under
oxlint without any code duplication. Add `@oxlint/plugins` and the plugin as
runtime dependencies, then reference it from your oxlint config:

```jsonc
// .oxlintrc.json
{
	"jsPlugins": ["eslint-plugin-awesome/oxlint"],
	"rules": {
		"awesome/my-new-rule": "error",
	},
}
```

The plugin key stays the same as under ESLint (`awesome`). Rules that require
TypeScript type information or a custom parser are ESLint-only, since oxlint's
JS plugin API supports neither.

## Development

Scripts you’ll use during development:

- `pnpm dev` – fast stub build for local iteration
- `pnpm build` – type-safe build with d.ts via tsdown
- `pnpm test` – run Vitest tests
- `pnpm lint` – run ESLint on this repo
- `pnpm typecheck` – run `tsc --noEmit`
- `pnpm eslint-docs` – regenerate README rules list
- `pnpm release` – bump version via bumpp

Requirements:

- Node.js >= 20
- pnpm >= 10
- ESLint >= 9.15.0 (peer dep for consumers)

## Project structure

```text
src/
	configs/            # Flat config presets (e.g., recommended)
	rules/              # Your rules (each in its own folder)
	plugin.ts           # Plugin host (name, version, rules)
	util.ts             # Rule creator with docs links
	index.ts            # Entry combining plugin + configs (default export)
scripts/
	create-rule.ts      # Scaffolds a new rule (code, tests, docs)
	template/           # Rule templates used by the script
```

{ "extends": ["plugin:awesome/recommended"] }

- The plugin key is computed from your package name (see `src/plugin.ts`).
- `src/configs/recommended` is provided for convenience; add your rules there
  when ready.

## Scaffolding a rule

```pwsh
pnpm create-rule my-new-rule
```

What happens:

1. Creates `src/rules/my-new-rule/` with `rule.ts`, `rule.spec.ts`,
   `documentation.md`.
2. Attempts to register the rule. If automatic edit cannot be applied, the
   script prints the exact import and entry you can paste into your plugin/index
   file.
3. Run `pnpm test` to validate, then `pnpm eslint-docs` to refresh this README.

## Publishing

Typical flow:

```pwsh
pnpm test
pnpm build
pnpm release   # chooses the next semver and commits tags
# CI publishes to npm
```

## Rules reference

Generate this section with:

```pwsh
pnpm eslint-docs
```

<!-- begin auto-generated rules list -->

🔧 Automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/user-guide/command-line-interface#--fix).\
💭
Requires [type information](https://typescript-eslint.io/linting/typed-linting).

| Name                                                                                          | Description                                                                      | 🔧  | 💭  |
| :-------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------- | :-- | :-- |
| [arrow-return-style](src/rules/arrow-return-style/documentation.md)                           | Enforce arrow function return style based on line length                         | 🔧  |     |
| [jsx-shorthand-boolean](src/rules/jsx-shorthand-boolean/documentation.md)                     | Disallow shorthand boolean JSX attributes                                        | 🔧  |     |
| [jsx-shorthand-fragment](src/rules/jsx-shorthand-fragment/documentation.md)                   | Enforce a consistent fragment form: the shorthand `<>...</>` or a named fragment | 🔧  |     |
| [naming-convention](src/rules/naming-convention/documentation.md)                             | Enforce naming conventions for everything across a codebase                      |     | 💭  |
| [no-export-default-arrow](src/rules/no-export-default-arrow/documentation.md)                 | Disallow anonymous arrow functions as export default declarations                | 🔧  |     |
| [no-unnecessary-use-callback](src/rules/no-unnecessary-use-callback/documentation.md)         | Disallow unnecessary usage of 'useCallback'                                      |     |     |
| [no-unnecessary-use-memo](src/rules/no-unnecessary-use-memo/documentation.md)                 | Disallow unnecessary usage of 'useMemo'                                          |     |     |
| [prefer-destructuring-assignment](src/rules/prefer-destructuring-assignment/documentation.md) | Enforce destructuring assignment for component props                             | 🔧  |     |
| [prefer-parameter-destructuring](src/rules/prefer-parameter-destructuring/documentation.md)   | Enforce destructuring parameters in the function signature                       | 🔧  |     |
| [prefer-read-only-props](src/rules/prefer-read-only-props/documentation.md)                   | Enforce that function component props are read-only                              | 🔧  | 💭  |
| [purity](src/rules/purity/documentation.md)                                                   | Disallow impure calls such as `math.random` or `os.clock` during render          |     |     |
| [toml-sort-keys](src/rules/toml-sort-keys/documentation.md)                                   | Enforce a configured sort order for TOML keys and tables                         | 🔧  |     |
| [yaml-block-key-blank-lines](src/rules/yaml-block-key-blank-lines/documentation.md)           | Enforce blank lines around top-level YAML block collection keys                  | 🔧  |     |

<!-- end auto-generated rules list -->

## Contributing

PRs and issues welcome. If you’re using this as a template, adapt the sections
to your needs and replace the badges and links.

## License

[MIT](./LICENSE) © 2025 [Christopher Buss](https://github.com/christopher-buss)

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/eslint-plugin-flawless
[npm-version-href]: https://npmjs.com/package/eslint-plugin-flawless
[npm-downloads-src]: https://img.shields.io/npm/dm/eslint-plugin-flawless
[npm-downloads-href]: https://npmjs.com/package/eslint-plugin-flawless
[license-src]:
	https://img.shields.io/github/license/christopher-buss/eslint-plugin-template.svg
[license-href]: ./LICENSE
