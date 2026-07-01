# Enforce a configured sort order for TOML keys and tables

📝 Enforce a configured sort order for TOML keys and tables.

🔧 This rule is automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

Enforces a **configured** order for TOML table headers and the key-value pairs
inside each table. Unlike `eslint-plugin-toml`'s `keys-order` / `tables-order`
(which only require related keys to be _adjacent_, with no configurable order),
this rule lets you express a semantic grouping — the same `order` /
`pathPattern` model as `yaml/sort-keys`.

Each option entry targets a table by its dotted path and supplies an order:

- `pathPattern` — a regular expression matched against the table's dotted path.
  The top-level table is the empty string `""` (matched by `^$`); a `[settings]`
  table is `settings`; a `[settings.node]` sub-table is `settings.node`.
- `order` — either an explicit array of names, or an object
  (`{ type: "asc" | "desc", natural?: boolean, caseSensitive?: boolean }`) to
  sort by name.

The first entry whose `pathPattern` matches a table wins. Names not present in
an explicit `order` array fall back to a natural-ascending sort **after** the
listed names (add a trailing `{ pathPattern: ".*", order: { type: "asc" } }`
entry to make unlisted tables deterministic).

Explicit-order matching is prefix-aware: `settings.node` matches an `order`
entry of `settings`, so sub-tables stay grouped directly under their parent
table and sort among themselves.

The rule works under both TOML entry points: the ESLint Languages API
(`language: "toml/toml"`) and the classic `toml-eslint-parser`
(`languageOptions.parser`).

### Autofix

Reordering moves whole `[table]` blocks (header + body) and individual
`key = value` lines. A comment on its own line directly above a key is treated
as attached and travels with it. If a comment cannot be attributed to a key (for
example, separated from it by a blank line), the rule reports but skips the
autofix to avoid stranding the comment.

Bare top-level keys are always kept before the first `[table]` header, since
TOML would otherwise re-scope them into that table.

## Options

```jsonc
[
	{ "pathPattern": "^$", "order": ["env", "vars", "settings", "tools"] },
	{ "pathPattern": "^settings$", "order": ["experimental", "lockfile"] },
	{ "pathPattern": ".*", "order": { "type": "asc", "natural": true } },
]
```

## Examples

Examples of **incorrect** code for this rule (with the options above):

```toml
[tools]
node = "lts"

[settings]
experimental = true
```

Examples of **correct** code for this rule:

```toml
[settings]
experimental = true

[tools]
node = "lts"
```
