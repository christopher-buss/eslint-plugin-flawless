# Disallow shorthand boolean JSX attributes

📝 Disallow shorthand boolean JSX attributes.

🔧 This rule is automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

Disallows shorthand boolean JSX attributes, requiring an explicit value such as
`prop={true}` instead of a bare `prop`. Making the value explicit keeps boolean
props visually consistent with every other prop and avoids ambiguity about
whether a value was intentionally omitted.

This re-implements the "never" policy of the removed
`@eslint-react/jsx-shorthand-boolean` rule.

## Examples

Examples of **incorrect** code for this rule:

```tsx
const element = <Component disabled />;
```

Examples of **correct** code for this rule:

```tsx
const element = <Component disabled={true} />;
```

## Further Reading

- [JSX spec: attributes](https://facebook.github.io/jsx/)
