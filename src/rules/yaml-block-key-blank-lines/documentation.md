# Enforce blank lines around top-level YAML block collection keys

📝 Enforce blank lines around top-level YAML block collection keys.

🔧 This rule is automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

Enforces a consistent blank line before and after every **top-level** YAML key
whose value is a block collection (a block mapping or block sequence), while
keeping leading scalar settings compact. Nested keys are left untouched.

This is the formatting wanted for files like `pnpm-workspace.yaml`, where
top-level sections (`packages:`, `overrides:`, `catalogs:`, …) read best when
separated by blank lines, but plain scalar settings at the top stay grouped
together. Neither Prettier nor `eslint-plugin-yml`'s
`yaml/no-multiple-empty-lines` (which only limits blank lines, never inserts
them) can express this.

The rule works under both YAML entry points: the ESLint Languages API
(`language: "yaml/yaml"`) and the classic `yaml-eslint-parser`
(`languageOptions.parser`).

Behavior, for each pair of adjacent top-level keys:

- If either key's value is a **block** collection, exactly one blank line is
  required between them (inserted if missing, collapsed if there are several).
- If both values are scalars (or **flow** collections such as `{ … }` / `[ … ]`,
  which count as scalars), no blank line is allowed between them (extra blanks
  are removed).

Gaps that contain a comment are skipped, to avoid re-attaching the comment to
the wrong key. Blank lines at the very start or end of the file, and the first
key, are left to other rules.

## Examples

Examples of **incorrect** code for this rule:

```yaml
name: test
version: 1.0.0
packages:
  - a
overrides:
  foo: bar
```

Examples of **correct** code for this rule:

```yaml
name: test
version: 1.0.0

packages:
  - a

overrides:
  foo: bar
```

Nested keys are unaffected:

```yaml
catalogs:
  dev:
    a: 1
  prod:
    b: 2
```

## Further Reading

- [`pnpm-workspace.yaml`](https://pnpm.io/pnpm-workspace_yaml)
