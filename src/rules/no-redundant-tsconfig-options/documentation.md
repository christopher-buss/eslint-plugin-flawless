# Disallow tsconfig options that redundantly re-set a value already provided by an extended config

📝 Disallow tsconfig options that redundantly re-set a value already provided by
an extended config.

🔧 This rule is automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

A `tsconfig.json` that `extends` another config inherits every option that
config sets. Re-declaring an option with the value it already inherits does
nothing but add noise — and hides which line actually changes behaviour. This
rule flags those redundant options and removes them on `--fix`.

It follows the full `extends` chain (the nearest ancestor that defines an option
wins) and understands both styles of `extends`:

- **relative / path** — `"extends": "../tsconfig.node.json"`
- **package** — `"extends": "@isentinel/tsconfig/typescript"` (resolved through
  the package's `exports` map)

Examples of **incorrect** code, given a parent that already sets
`"target": "esnext"` and `"composite": true`:

```jsonc
{
	"extends": "./tsconfig.base.json",
	"compilerOptions": {
		"target": "esnext", // redundant — same as the parent
		"composite": true, // redundant — same as the parent
		"noEmit": false, // fine — overrides the parent
	},
}
```

Examples of **correct** code:

```jsonc
{
	"extends": "./tsconfig.base.json",
	"compilerOptions": {
		"target": "es2020", // a real override
		"lib": ["esnext"], // a narrower value than the inherited array
	},
}
```

## What is checked

- Every key inside `compilerOptions`.
- The top-level `include`, `exclude`, and `files` (which replace, rather than
  merge, so an identical re-declaration is still redundant). `references` and
  `extends` themselves are never flagged.

### Comparison rules

- Values compare **structurally** — an array or object is redundant only when it
  is deeply equal to the inherited one (`"lib": ["esnext"]` is _not_ redundant
  against an inherited `["esnext", "dom"]`).
- Enum-valued options (`target`, `module`, `moduleResolution`,
  `moduleDetection`, `jsx`, `newLine`, and `lib` entries) compare
  **case-insensitively**, matching how TypeScript resolves them —
  `"target": "ESNext"` is redundant against `"esnext"`.
- `null` is a real value used to _unset_ an inherited option, so it is never
  treated as equal to the value it clears.
- **Path-valued options** (`outDir`, `baseUrl`, `rootDir`, `paths`, `typeRoots`,
  `include`, `exclude`, `files`, …) are resolved relative to the config that
  declares them, so an identical plain-relative value in a child actually points
  somewhere different and is left alone. They are flagged only when the value is
  location-independent — anchored with `${configDir}` or absolute — so it
  genuinely resolves to the same files.

### Autofix

The redundant property is removed along with its delimiter comma. When a comment
is attached to the property, the rule reports without fixing, to avoid stranding
the comment.

## When not to use it

The rule reads the extended configs from disk relative to the linted file, so it
needs the file to be linted from its real location. It has no effect on a config
without an `extends`.

## Setup

The rule runs on JSONC and must be paired with
[`jsonc-eslint-parser`](https://www.npmjs.com/package/jsonc-eslint-parser) for
your tsconfig files:

```js
import jsoncParser from "jsonc-eslint-parser";

export default [
	{
		files: ["**/tsconfig*.json"],
		languageOptions: { parser: jsoncParser },
		rules: {
			"flawless/no-redundant-tsconfig-options": "error",
		},
	},
];
```
