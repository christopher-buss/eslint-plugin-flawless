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

💭 Requires
[type information](https://typescript-eslint.io/linting/typed-linting).

| Name                                                              | Description                                                 | 💭  |
| :---------------------------------------------------------------- | :---------------------------------------------------------- | :-- |
| [naming-convention](src/rules/naming-convention/documentation.md) | Enforce naming conventions for everything across a codebase | 💭  |

<!-- end auto-generated rules list -->

## Contributing

PRs and issues welcome. If you’re using this as a template, adapt the sections
to your needs and replace the badges and links.

## License

[MIT](./LICENSE) © 2025 [Christopher Buss](https://github.com/christopher-buss)

<!-- Badges -->

[npm-version-src]:
	https://img.shields.io/npm/v/eslint-plugin-template-placeholder
[npm-version-href]: https://npmjs.com/package/eslint-plugin-template-placeholder
[npm-downloads-src]:
	https://img.shields.io/npm/dm/eslint-plugin-template-placeholder
[npm-downloads-href]:
	https://npmjs.com/package/eslint-plugin-template-placeholder
[license-src]:
	https://img.shields.io/github/license/christopher-buss/eslint-plugin-template.svg
[license-href]: ./LICENSE
