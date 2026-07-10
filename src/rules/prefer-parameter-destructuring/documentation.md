# Enforce destructuring parameters in the function signature

📝 Enforce destructuring parameters in the function signature.

🔧 This rule is automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

Reports object destructuring statements at the top of a function body
(`const { a } = obj`) when the parameter has no other use, preferring the
pattern directly in the function signature. Signature destructuring keeps a
function's real inputs visible where they are declared and removes a redundant
intermediate binding.

```ts
// ✗ the parameter exists only to be destructured
function bar(object: Item): void {
	const { a } = object;
	console.log(a);
}

// ✓ fixed
function bar({ a }: Item): void {
	console.log(a);
}
```

Any other reference to the parameter — a call argument, member access, `return`,
spread, reassignment, or a destructure inside a nested block or closure — means
the parameter is genuinely used, and the function is left alone:

```ts
function bar(object: Item): void {
	const { a } = object;
	console.log(a);
	baz(object); // the object itself is really used
}
```

Only object patterns are checked; array destructuring (`const [a] = pair`) is
out of scope. Bare member access (`obj.a`) is not reported either — that is core
[`prefer-destructuring`](https://eslint.org/docs/latest/rules/prefer-destructuring)'s
territory, and the two rules compose: it funnels member access into a body
destructure, which this rule then lifts into the signature. For React component
props specifically, see the sibling rule
[`prefer-destructuring-assignment`](../prefer-destructuring-assignment/documentation.md).

No general-purpose equivalent exists elsewhere: `react/destructuring-assignment`
with `destructureInSignature: "always"` has these semantics but only fires
inside detected React components.

## Autofix

The fix rewrites the parameter (preserving its type annotation and default
value, and parenthesizing a bare arrow parameter) and removes the body
statements. Multiple destructures of the same parameter merge into one pattern:

```ts
function sum(object: Input): number {
	const { a } = object;
	const { b } = object;
	return a + b;
}

// becomes

function sum({ a, b }: Input): number {
	return a + b;
}
```

The fix is only offered when it is unambiguously safe. The code is reported but
left untouched when:

- the declaration has an unrelated sibling declarator
  (`const { a } = obj, x = 1`).
- a computed key or default value references something unavailable at the
  parameter position: a binding declared in the function body, a parameter at or
  after the rewritten one, or the function's own `arguments`.
- merging would duplicate a binding name, collide with another parameter's name,
  or move a rest element away from last place.
- both the pattern and the parameter carry a type annotation (a lone pattern
  annotation moves to the signature).
- a bound name is referenced before the destructuring statement (e.g. by a
  hoisted closure) — moving the binding into the parameter list would erase its
  temporal dead zone and turn a runtime error into an ordinary read.
- with [`allowSideEffectReordering: false`](#options): the pattern contains a
  default value or computed key and the destructure is not at the very top of
  the body — those execute code, and hoisting them into the signature reorders
  their side effects past the statements above.

Some caveats are accepted rather than blocking the fix: property reads move to
call time (observable only with getters or proxies); `const` bindings become
parameters, which are reassignable — the original code could not have reassigned
them anyway; and by default, side effects in pattern defaults and computed keys
may move ahead of earlier statements — code should not rely on their ordering
(opt out with `allowSideEffectReordering: false`).

Some functions are not reported at all, because no signature form exists:

- a pattern containing `await` or `yield`
  (`const { a = await fetchDefault() } = options`), which may not appear in
  parameter initializers.
- functions whose body opens with a `"use strict"` directive, since a
  destructured parameter makes the parameter list non-simple and the directive
  would become a syntax error.

## Options

<!-- begin auto-generated rule options list -->

| Name                        | Description                                                                                                                                                               | Type    | Default |
| :-------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------ | :------ |
| `allowSideEffectReordering` | Whether the autofix may hoist pattern defaults and computed keys past earlier statements, reordering their side effects. Set to false to withhold the fix in those cases. | Boolean | `true`  |

<!-- end auto-generated rule options list -->

```json
{
	"flawless/prefer-parameter-destructuring": [
		"error",
		{ "allowSideEffectReordering": false }
	]
}
```

## Examples

Examples of **incorrect** code for this rule:

```ts
function bar(object: Item): void {
	const { a } = object;
	console.log(a);
}
```

```ts
function handle(event: InputEvent): void {
	const { target } = event;
	doSomething(target);
}
```

Examples of **correct** code for this rule:

```ts
function bar({ a }: Item): void {
	console.log(a);
}
```

```ts
function bar(object: Item): void {
	const { a } = object;
	console.log(a);
	baz(object); // the original object is still needed
}
```

```ts
function bar(object: Item): void {
	if (condition) {
		const { a } = object; // conditional destructuring stays put
		console.log(a);
	}

	console.log("done");
}
```

## Further Reading

- [MDN: Destructuring assignment](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Destructuring_assignment)
- [`react/destructuring-assignment` `destructureInSignature` option](https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/destructuring-assignment.md)
- [eslint/eslint#12710 — request for parameter support in `prefer-destructuring`](https://github.com/eslint/eslint/issues/12710)
