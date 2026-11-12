# eslint-plugin-flawless

> My personal, opinionated set of ESLint rules.

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]

## Why this plugin exists

I write these rules for my own projects. Some are rules I wanted and could not
find. Others are ports of rules from other plugins, rewritten because the
original was slow or had bugs.

The plugin has no single theme, and it does not try to be a complete rule set.
It is the set of checks I want in my own code. The rules are public, so you can
use any of them in your projects.

Today the rules cover these areas:

- **TypeScript types**: redundant annotations, `unknown` parameters and returns,
  unsafe dictionary types, and value widening.
- **React**: unnecessary `useMemo` and `useCallback`, read-only props, prop
  destructuring, render purity, and JSX shorthand.
- **Tests**: shared mocks and state, conditional logic, assertion counts, and
  Vitest local context.
- **Config files**: key order in TOML and YAML, and redundant `tsconfig.json`
  options.
- **Style**: arrow return style, comment length, naming conventions, and em
  dashes.

Each rule has its own page with examples and options. See the
[rules reference](#rules-reference).

## Install

```sh
pnpm add -D eslint-plugin-flawless
```

Requirements:

- Node.js 24.12.0 or later
- ESLint 9.15.0 or later
- TypeScript 4.8.4 or later, below 6.1.0

## Use with ESLint

Register the plugin in your flat config, then turn on the rules you want. The
plugin key is `flawless`.

```ts
// eslint.config.ts
import flawless from "eslint-plugin-flawless";

export default [
	{
		plugins: {
			flawless,
		},
		rules: {
			"flawless/no-shared-mocks": "error",
			"flawless/no-unnecessary-use-memo": "error",
			"flawless/prefer-mock-throw": "error",
		},
	},
];
```

Rules marked 💭 in the reference need
[typed linting](https://typescript-eslint.io/getting-started/typed-linting). The
TOML, YAML, and `tsconfig.json` rules need the matching parser or language for
those files. Each rule page gives the setup.

## Use with oxlint

The plugin also ships an
[oxlint JS plugin](https://oxc.rs/docs/guide/usage/linter/writing-js-plugins) at
`eslint-plugin-flawless/oxlint`. It needs oxlint 1.78.0 or later.

```jsonc
// .oxlintrc.json
{
	"jsPlugins": ["eslint-plugin-flawless/oxlint"],
	"rules": {
		"flawless/no-unnecessary-use-memo": "error",
	},
}
```

The rule names are the same as in ESLint. The oxlint JS plugin API does not
support type information or custom parsers, so these rules run in ESLint only:

- `naming-convention`
- `no-redundant-tsconfig-options`
- `no-redundant-type-annotation`
- `no-unknown-returns`
- `prefer-read-only-props`
- `toml-sort-keys`
- `yaml-block-key-blank-lines`
- `yaml-sort-sequence-by-key`

Other rules marked 💭 also run in oxlint, but they find fewer problems without
type information. Each rule page gives the details.

## Rules reference

<!-- begin auto-generated rules list -->

🔧 Automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/user-guide/command-line-interface#--fix).\
💡
Manually fixable by
[editor suggestions](https://eslint.org/docs/latest/use/core-concepts#rule-suggestions).\
💭
Requires [type information](https://typescript-eslint.io/linting/typed-linting).

| Name                                                                                                | Description                                                                                                                         | 🔧  | 💡  | 💭  |
| :-------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------- | :-- | :-- | :-- |
| [arrow-return-style](src/rules/arrow-return-style/documentation.md)                                 | Enforce arrow function return style based on line length                                                                            | 🔧  |     |     |
| [cognitive-complexity](src/rules/cognitive-complexity/documentation.md)                             | Limit the Cognitive Complexity of each function                                                                                     |     |     |     |
| [jsx-shorthand-boolean](src/rules/jsx-shorthand-boolean/documentation.md)                           | Disallow shorthand boolean JSX attributes                                                                                           | 🔧  |     |     |
| [jsx-shorthand-fragment](src/rules/jsx-shorthand-fragment/documentation.md)                         | Enforce a consistent fragment form: the shorthand `<>...</>` or a named fragment                                                    | 🔧  |     |     |
| [max-comment-length](src/rules/max-comment-length/documentation.md)                                 | Limit comments by word count                                                                                                        |     |     |     |
| [max-lines-per-function](src/rules/max-lines-per-function/documentation.md)                         | Enforce a maximum number of lines of code in a function                                                                             |     |     |     |
| [naming-convention](src/rules/naming-convention/documentation.md)                                   | Enforce naming conventions for everything across a codebase                                                                         |     |     | 💭  |
| [no-conditional-empty-object-spread](src/rules/no-conditional-empty-object-spread/documentation.md) | Disallow conditional empty-object spreads                                                                                           |     |     |     |
| [no-conditional-in-test](src/rules/no-conditional-in-test/documentation.md)                         | Disallow conditional logic in tests                                                                                                 | 🔧  |     |     |
| [no-em-dash](src/rules/no-em-dash/documentation.md)                                                 | Disallow em dashes in comments, strings, JSX text, and Markdown prose                                                               |     |     |     |
| [no-export-default-arrow](src/rules/no-export-default-arrow/documentation.md)                       | Disallow anonymous arrow functions as export default declarations                                                                   | 🔧  |     |     |
| [no-floating-point-equality](src/rules/no-floating-point-equality/documentation.md)                 | Disallow exact equality checks involving floating-point-sensitive values                                                            |     |     |     |
| [no-ignored-return](src/rules/no-ignored-return/documentation.md)                                   | Disallow ignoring the result of a built-in method that has no side effects                                                          |     |     | 💭  |
| [no-incompatible-assertion-types](src/rules/no-incompatible-assertion-types/documentation.md)       | Disallow equality assertions whose operands have types that can never be equal                                                      |     |     | 💭  |
| [no-known-value-widening](src/rules/no-known-value-widening/documentation.md)                       | Disallow syntactically established values from flowing into explicitly broad or anonymous target types that discard useful evidence |     |     |     |
| [no-materialized-filter-map](src/rules/no-materialized-filter-map/documentation.md)                 | Disallow copying an iterable into an array only to `filter` or `map` it                                                             | 🔧  | 💡  | 💭  |
| [no-object-parameters](src/rules/no-object-parameters/documentation.md)                             | Disallow function parameters that accept any object shape                                                                           |     |     |     |
| [no-redundant-tsconfig-options](src/rules/no-redundant-tsconfig-options/documentation.md)           | Disallow tsconfig options that redundantly re-set a value already provided by an extended config                                    | 🔧  |     |     |
| [no-redundant-type-annotation](src/rules/no-redundant-type-annotation/documentation.md)             | Disallow type annotations that restate the initializer's own type                                                                   | 🔧  |     | 💭  |
| [no-reflect-get](src/rules/no-reflect-get/documentation.md)                                         | Disallow the two-argument `Reflect.get` in favour of typed property access                                                          |     |     |     |
| [no-reflect-set](src/rules/no-reflect-set/documentation.md)                                         | Disallow `Reflect.set` with a compile-time-fixed key in favour of a plain assignment                                                |     |     | 💭  |
| [no-shape-in-symbol-names](src/rules/no-shape-in-symbol-names/documentation.md)                     | Disallow the term 'shape' in declared symbol names                                                                                  |     |     |     |
| [no-shared-mocks](src/rules/no-shared-mocks/documentation.md)                                       | Disallow mocks created once and shared between tests                                                                                |     |     |     |
| [no-shared-test-state](src/rules/no-shared-test-state/documentation.md)                             | Disallow state declared outside tests and written inside them                                                                       |     |     |     |
| [no-trivial-functions](src/rules/no-trivial-functions/documentation.md)                             | Disallow rarely used top-level functions that only forward their parameters or read a parameter's property                          |     |     |     |
| [no-unknown-parameters](src/rules/no-unknown-parameters/documentation.md)                           | Disallow `unknown` function parameters outside type-predicate subjects and recorded error causes                                    |     |     |     |
| [no-unknown-returns](src/rules/no-unknown-returns/documentation.md)                                 | Disallow explicit return type annotations that resolve to `unknown`                                                                 |     |     | 💭  |
| [no-unnecessary-prop-alias](src/rules/no-unnecessary-prop-alias/documentation.md)                   | Disallow unnecessary aliases when destructuring component props                                                                     |     |     |     |
| [no-unnecessary-use-callback](src/rules/no-unnecessary-use-callback/documentation.md)               | Disallow unnecessary usage of 'useCallback'                                                                                         |     |     |     |
| [no-unnecessary-use-memo](src/rules/no-unnecessary-use-memo/documentation.md)                       | Disallow unnecessary usage of 'useMemo'                                                                                             |     |     |     |
| [no-unsafe-dictionary-type](src/rules/no-unsafe-dictionary-type/documentation.md)                   | Disallow unsafe object dictionary value types                                                                                       |     |     |     |
| [padding-after-expect-assertions](src/rules/padding-after-expect-assertions/documentation.md)       | Enforce a blank line after `expect.assertions` and `expect.hasAssertions`                                                           | 🔧  |     |     |
| [prefer-destructuring-assignment](src/rules/prefer-destructuring-assignment/documentation.md)       | Enforce destructuring assignment for component props                                                                                | 🔧  |     |     |
| [prefer-ending-with-an-expect](src/rules/prefer-ending-with-an-expect/documentation.md)             | Prefer having the last statement in a test be an assertion                                                                          |     |     |     |
| [prefer-expect-assertions-count](src/rules/prefer-expect-assertions-count/documentation.md)         | Prefer `expect.assertions(<count>)` over `expect.hasAssertions()`                                                                   |     |     |     |
| [prefer-mock-throw](src/rules/prefer-mock-throw/documentation.md)                                   | Prefer `mockThrow` / `mockThrowOnce` over a mock implementation that only throws                                                    | 🔧  |     |     |
| [prefer-parameter-destructuring](src/rules/prefer-parameter-destructuring/documentation.md)         | Enforce destructuring parameters in the function signature                                                                          | 🔧  |     |     |
| [prefer-read-only-props](src/rules/prefer-read-only-props/documentation.md)                         | Enforce that function component props are read-only                                                                                 | 🔧  |     | 💭  |
| [prefer-vitest-local-context](src/rules/prefer-vitest-local-context/documentation.md)               | Prefer test-bound Vitest APIs from the local test context                                                                           | 🔧  |     |     |
| [purity](src/rules/purity/documentation.md)                                                         | Disallow impure calls such as `math.random` or `os.clock` during render                                                             |     |     |     |
| [react-namespace](src/rules/react-namespace/documentation.md)                                       | Prefer named imports for React runtime values and the React namespace for React types                                               | 🔧  |     |     |
| [toml-sort-keys](src/rules/toml-sort-keys/documentation.md)                                         | Enforce a configured sort order for TOML keys and tables                                                                            | 🔧  |     |     |
| [yaml-block-key-blank-lines](src/rules/yaml-block-key-blank-lines/documentation.md)                 | Enforce blank lines around top-level YAML block collection keys                                                                     | 🔧  |     |     |
| [yaml-sort-sequence-by-key](src/rules/yaml-sort-sequence-by-key/documentation.md)                   | Enforce sorted YAML sequences of mappings by a key                                                                                  | 🔧  |     |     |

<!-- end auto-generated rules list -->

## License

[MIT](./LICENSE) © 2025 [Christopher Buss](https://github.com/christopher-buss)

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/eslint-plugin-flawless
[npm-version-href]: https://npmjs.com/package/eslint-plugin-flawless
[npm-downloads-src]: https://img.shields.io/npm/dm/eslint-plugin-flawless
[npm-downloads-href]: https://npmjs.com/package/eslint-plugin-flawless
[license-src]: https://img.shields.io/npm/l/eslint-plugin-flawless
[license-href]: ./LICENSE
