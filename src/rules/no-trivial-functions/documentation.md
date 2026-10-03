# Disallow rarely used top-level functions that only forward their parameters or read a parameter's property

📝 Disallow rarely used top-level functions that only forward their parameters
or read a parameter's property.

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

A top-level function that only reads a parameter's property, or only forwards
its parameters to another call, adds a name and an indirection without adding
behaviour. When it is called in just a few places, inlining it is clearer. This
rule reports such functions when they have fewer external calls than
`minimumReferences` (default `5`).

A function is trivial when it is not `async` or a generator, every parameter is
a plain identifier (a rest identifier is allowed; a TypeScript `this` parameter
is ignored), and its body — a concise arrow body, or a block holding a single
`return` or expression statement — is one of:

- a non-optional member access rooted at a non-rest parameter, such as
  `user.profile.name`, `list[0]`, or `list[index]`; a computed key must be a
  literal or a parameter;
- a non-optional call passing exactly the parameters in order, with a rest
  parameter spread back out, such as `format(value, ...rest)`; the callee must
  be a name or a non-computed member chain rooted at a name.

Only top-level function declarations and function-valued `const`/`let`/`var`
declarators in ES modules are checked; in a script, top-level declarations are
globals. (Under oxlint, a file with no `import` or `export` is a script.) The
rule reports only when inlining is provably safe, so a function is skipped when:

- it is exported: directly (`export function`, `export const`), or referenced
  anywhere inside an `export` statement, `export =`, or a `module.exports` /
  `exports.x` assignment (type-only exports and re-exports do not count);
- it is reassigned;
- any reference is not a direct call, such as `values.map(toInt)`, because
  inlining would change arity, `this`, or identity.

References inside the function itself (recursion) and `typeof` type queries do
not count. Calls through `as`, `!`, or angle-bracket assertions do count.

## Examples

Examples of **incorrect** code for this rule:

```ts
function getName(user: User): string {
	return user.profile.name;
}

function parse(value: string): number {
	return parseValue(value);
}

render(getName(user), parse(input));
```

Examples of **correct** code for this rule:

```ts
render(user.profile.name, parseValue(input));

// Exported, so part of the module's interface.
export function getId(user: User): string {
	return user.id;
}

// Adds behaviour.
function increment(value: number): number {
	return value + 1;
}
```

## Options

<!-- begin auto-generated rule options list -->

| Name                | Description                                                                                | Type    | Default |
| :------------------ | :----------------------------------------------------------------------------------------- | :------ | :------ |
| `minimumReferences` | The number of external value references at which a trivial function is no longer reported. | Integer | `5`     |

<!-- end auto-generated rule options list -->

```json
{
	"flawless/no-trivial-functions": ["error", { "minimumReferences": 3 }]
}
```

## Credits

Ported from the `no-trivial-functions` rule of
[eslint-plugin-slop](https://github.com/antfu/eslint-plugin-slop) by Anthony Fu
(MIT).
