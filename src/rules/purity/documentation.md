# Disallow impure calls such as `math.random` or `os.clock` during render

📝 Disallow impure calls such as `math.random` or `os.clock` during render.

<!-- end auto-generated rule header -->
<!-- Do not manually modify this header. Run: `pnpm eslint-docs` -->

## Rule details

React components and hooks must be
[pure](https://react.dev/reference/rules/components-and-hooks-must-be-pure):
given the same inputs they must produce the same output, with no side effects
during render. Calling a non-deterministic API during render (randomness, or the
current time/clock) breaks that contract and causes bugs such as stale
memoization and inconsistent renders.

This is a roblox-ts port of the upstream `react-hooks` / `eslint-react` `purity`
rule. The upstream rule targets JavaScript APIs (`Math.random`, `Date.now`,
`crypto.*`, `performance.now`) that **do not exist** in roblox-ts. This rule
targets the Luau / Roblox equivalents instead.

The rule only flags impure calls made **during render** — directly in a
component body, a custom/builtin hook body, or a `useMemo` callback. It does
**not** flag calls inside event handlers, `useEffect` (and other effect hooks)
callbacks, `useState` lazy initializers, or `useCallback` bodies, because those
do not run during render.

Default impure signatures:

- **Randomness:** `math.random`, `math.randomseed`, `Random.new` (i.e.
  `new Random()`), `HttpService.GenerateGUID`
- **Time / clock:** `os.time`, `os.clock`, `os.date`, `tick`, `time`,
  `elapsedTime`, `DateTime.now`, `Workspace.GetServerTimeNow`

`new Random(seed)` with an explicit seed is deterministic and is **not**
flagged; only the seedless `new Random()` reads the clock.

### Known limitations

- **Dynamically-obtained services** are not matched. Only the direct-global
  forms (`HttpService.GenerateGUID`, `Workspace.GetServerTimeNow`) are detected;
  a call routed through `game.GetService("HttpService").GenerateGUID()` or a
  local alias is not, because reliable matching would require type information.
  For the same reason, a lowercase `workspace.GetServerTimeNow()` receiver is
  not matched by the `Workspace.GetServerTimeNow` signature.
- **Indirection through a helper function** is not tracked — an impure call
  inside a plain helper defined in the component body is not flagged.
- **Computed access** (`os["clock"]()`) is intentionally not matched.
- **Receiver-dependent calls** cannot be matched by signature, so `Random`
  instance methods (`rng.NextNumber()`, `rng.NextInteger()`) are not flagged
  even though they are impure.
- Bare Luau globals (`math`, `os`, `tick`, `time`, `elapsedTime`) are skipped
  when a local binding shadows them.

## Examples

Examples of **incorrect** code for this rule:

```tsx
import type { Element } from "@rbxts/react";

function Component(): Element {
	// Non-deterministic: re-runs on every render.
	const id = math.random();
	return <textlabel Text={tostring(id)} />;
}

function useToken(): string {
	return HttpService.GenerateGUID();
}
```

Examples of **correct** code for this rule:

```tsx
import { useState } from "@rbxts/react";
import type { Element } from "@rbxts/react";

function Component(): Element {
	// Deferred to a state initializer — runs once, not during render.
	const [id] = useState(() => math.random());
	return <textlabel Text={tostring(id)} />;
}
```

```tsx
import type { Element } from "@rbxts/react";

function Component(): Element {
	// The event handler runs on activation, not during render.
	return <textbutton Event={{ Activated: () => math.random() }} />;
}
```

## Options

This rule accepts an options object:

<!-- begin auto-generated rule options list -->

| Name                  | Description                                                           | Type     |
| :-------------------- | :-------------------------------------------------------------------- | :------- |
| `additionalFunctions` | Extra dotted call signatures to treat as impure (e.g. "Math.random"). | String[] |
| `ignore`              | Default signatures to exclude (e.g. "os.date").                       | String[] |

<!-- end auto-generated rule options list -->

- `additionalFunctions` — extra dotted call signatures to treat as impure, added
  to the defaults. Use this when a call is impure in your project, e.g. a Luau
  `Math` polyfill: `"Math.random"`. Other useful opt-ins that are deliberately
  left out of the defaults: `"task.wait"`, `"wait"`, and `"Instance.new"` (these
  are side-effecting / yielding rather than strictly non-deterministic).
- `ignore` — default signatures to exclude, e.g. `"os.date"`.

Example configuration with options:

```json
{
	"roblox-ts/purity": [
		"error",
		{
			"additionalFunctions": ["Math.random"],
			"ignore": ["os.date"]
		}
	]
}
```

## Further Reading

- [Components and Hooks must be pure — React](https://react.dev/reference/rules/components-and-hooks-must-be-pure)
- [`purity` — eslint-react](https://eslint-react.xyz/docs/rules/purity)
