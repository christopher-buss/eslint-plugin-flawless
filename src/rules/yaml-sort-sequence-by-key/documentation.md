# Enforce sorted YAML sequences of mappings by a key

📝 Enforce sorted YAML sequences of mappings by a key.

🔧 This rule is automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

Sorts a YAML sequence whose entries are mappings by the value of one key, for
example a GitHub labels file sorted by `name`. `yaml/sort-sequence-values` only
compares scalar entries, so it cannot sort a list of mappings.

A sequence is checked when its path matches a configured `pathPattern`. Every
entry must be a mapping with a string or number value at `key`; if one entry
does not, the rule skips the whole sequence. A string and a number never count
as out of order (as in `yaml/sort-sequence-values`), so `b, 1, a` gives no
report; quote values such as `2024` in a list of string names. `.nan` never
counts as out of order either.

The rule works under both YAML entry points: the ESLint Languages API
(`language: "yaml/yaml"`) and the classic `yaml-eslint-parser`.

### Autofix

The fix rewrites the whole sequence at once, so one `--fix` pass is enough.

- Block sequences: each entry moves together with the comment lines directly
  above it (no blank line between the comment and the `-`, and the comment in
  the same column as the `-`) and with a comment at the end of its last line.
  The separators between entries stay in their positions, so blank lines between
  entries are kept. A comment followed by a blank line before the first entry (a
  file header) stays in place.
- Flow sequences (`[{ name: b }, { name: a }]`) are fixed the same way, unless
  they contain comments.
- If a comment sits between two entries and belongs to neither (it has a blank
  line below it, or it is in another column than the `-`), the rule reports
  without a fix.
- Sorting is stable: entries with equal keys keep their order.
- Anchors and aliases: as in `yaml/sort-sequence-values`, two entries never swap
  when one uses an anchor that the other defines. Other entries still sort and
  are fixed. Only aliases inside the sequence are checked: if two entries define
  the same anchor name, the fix can change what a later alias outside the
  sequence resolves to.

## Options

An array of objects. The first object whose `pathPattern` matches wins. With no
objects, the rule does nothing.

- `pathPattern` (`string`, required): a regular expression for the sequence
  path, in the syntax of `yaml/sort-keys`. `^$` matches the root sequence;
  nested paths look like `updates` or `foo.bar[0].baz`.
- `key` (`string`, required): the mapping key to sort by.
- `order` (`object`): the same order object as `yaml/sort-sequence-values`.
  - `type`: `"asc"` (default) or `"desc"`.
  - `caseSensitive`: default `true`. Strings compare by code unit, so `B` comes
    before `a`.
  - `natural`: default `false`. When `true`, `item2` comes before `item10`.

```js
export default [
	{
		files: [".github/labels.yaml"],
		rules: {
			"flawless/yaml-sort-sequence-by-key": ["error", { key: "name", pathPattern: "^$" }],
		},
	},
];
```

## Examples

Examples of **incorrect** code for this rule:

```yaml
# GitHub Labels Configuration

- name: feature
  color: 0e8a16
  description: New feature

- name: bug
  color: d73a4a
  description: Bug fix
```

Examples of **correct** code for this rule:

```yaml
# GitHub Labels Configuration

- name: bug
  color: d73a4a
  description: Bug fix

- name: feature
  color: 0e8a16
  description: New feature
```
