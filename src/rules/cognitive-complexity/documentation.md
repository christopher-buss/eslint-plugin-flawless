# Limit the Cognitive Complexity of each function

📝 Limit the Cognitive Complexity of each function.

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

Cognitive Complexity measures how hard a function is to read. Each break in the
linear flow of the code adds to the score, and a break inside another break adds
more. This rule reports each function whose score is above a threshold.

The metric comes from the Cognitive Complexity white paper by G. Ann Campbell
(SonarSource, 2017). The scores of this rule are the same as those of the
SonarJS rule S3776 (version 4.2.2), except for the known differences below.

### Scoring

The score of a function counts only its own code. A nested function gets its own
score and its own report. It adds nothing to the score of the outer function,
and it does not raise the nesting level of the code inside it. Code outside all
functions has no score.

**Structural increment: +1, plus the nesting level**

- `if` (but not the `if` of an `else if`)
- `for`, `for…in`, `for…of`, `while`, `do…while`
- `switch` (once, not for each `case`)
- `catch`
- `?:`

**Flat increment: +1**

- `else if`, `else`
- `break label` and `continue label` (only with a label)
- each run of `&&` in a chain of logical operators. A run starts when the
  operator changes. `||` and `??` add nothing.

**The nesting level is one higher inside**

- the `then` branch of an `if`, and an `else` branch that is not an `else if`
- the body of a loop (not its init, test or update)
- each `case` of a `switch` (its test too)
- the body of a `catch`
- the two branches of `?:` (not its test)

**No increment**

- recursion, `try`, `finally`, `case`, optional chaining, default parameters
- the assignment operators `&&=`, `||=` and `??=`
- a logical chain directly in a JSX expression container, when the chain uses
  one operator only and no direct operand is a `?:` (`{a && b && <X />}`)

A chain continues only through direct logical children. Thus in `!(a && b) && c`
the `a && b` is a different chain, and the score is 2.

### Known differences

From the white paper:

- `||` and `??` add nothing. Only `&&` runs count.
- Recursion adds nothing.
- A nested function does not raise the nesting level of its code.
- The JSX exemption above is not in the paper.

From SonarJS S3776 4.2.2:

- In S3776, a function that is a branch of `?:` (`t ? () => a : b`) raises the
  nesting level of all the code after it in the outer function. This rule does
  not. Thus `g(t ? 1 : () => 1); if (u) {}` has the score 2 here and 3 in S3776.
- There is no `"silence-issues"` option and no `sonarRuntime` output.
- The options are an object, not a bare number. Write
  `["error", { "threshold": 15 }]`, not `["error", 15]`.

The rule looks for the report location only when a function reports. Thus the
cost of the rule grows linearly with the size of the file.

## Examples

Examples of **incorrect** code with `{ "threshold": 3 }`:

```ts
function find(items: Array<number>, limit: number): number {
	// for: +1
	for (const item of items) {
		// if: +2 (nesting 1)
		if (item > limit) {
			// ?: +3 (nesting 2)
			return item > 100 ? 100 : item;
		}
	}

	return -1;
} // Score 6.
```

Examples of **correct** code with `{ "threshold": 3 }`:

```ts
function clamp(item: number): number {
	return item > 100 ? 100 : item; // +1
}

function find(items: Array<number>, limit: number): number {
	const found = items.find((item) => item > limit); // +0
	return found === undefined ? -1 : clamp(found); // +1
} // Score 1.
```

## Options

<!-- begin auto-generated rule options list -->

| Name        | Description                                           | Type    | Default |
| :---------- | :---------------------------------------------------- | :------ | :------ |
| `threshold` | The highest Cognitive Complexity a function may have. | Integer | `15`    |

<!-- end auto-generated rule options list -->

Example configuration:

```json
{
	"flawless/cognitive-complexity": ["error", { "threshold": 15 }]
}
```

## Further Reading

- G. Ann Campbell, _Cognitive Complexity: A new way of measuring
  understandability_, SonarSource, 2017.
