# Bugs

Ordered by how often this came up in past reviews. The number is rough weight, not a score.

## Contents

- Decide from AST nodes and checker types, not source text or printed names
- Resolve static keys and values instead of matching only `Literal` nodes
- Match by declaration, not by name: confirm it's the real global
- Cover the whole syntax family of the matched construct
- Treat `as` and `in` on AST nodes as signs of an unhandled case
- Decide how a typed rule treats `any`, `unknown`, and `error` types
- Walk into unions, intersections, arrays, and tuples
- Justify every exemption
- Resolve type parameters to their constraints
- Keep checking after one unhandled element
- Report even when no fix can be produced
- Apply a change to every report path
- Don't report when the rule can't be confident
- Keep results independent of unrelated code aspects
- Detect types by behavior instead of hard-coding built-in names
- Check type flags with helpers, not `===`
- Keep traversal state in a stack that tolerates nesting
- Resolve TODOs for unhandled syntax before merging
- Don't assume a fixed parent depth
- Don't hand-roll declaration or lib file detection

## Decide from AST nodes and checker types, not source text or printed names

(17)

Look for `sourceCode.getText` or `node.getText` used to decide equality. Compare nodes and tokens, and when the rule is about type meaning, compare `ts.Type` objects with `===`.

Why: Text comparison breaks when a comment appears, which would confuse users. Even AST comparison misses equivalent types such as `"1" | '1'` or aliases of the same type.

Verify: Test `if (a /* ... */ .b === a.b)` still reports, and `type A = string; type B = string; type C = A | B;` for duplicate-type checks.

> We generally try not to use `sourceCode.getText` or similar in rules if at all possible. It's less reliable than comparing AST and/or types

> As convenient as `sourceCode.getText` is, most cases where it's used are susceptible to bugs.

## Resolve static keys and values instead of matching only `Literal` nodes

(15)

Look for `type === AST_NODE_TYPES.Literal` or `Identifier` checks on computed keys, indexes, and string arguments. They miss `[key]` with a const variable, `['p1']` compared against `p1`, and template literals. Use `getStaticValue` or an equivalent utility.

Why: Computed keys aren't just literals, and a hand-written literal check silently skips them. `getStaticValue` is the standard utility, but truly funky computed expressions and variables used as method names don't need support.

Verify: Add as `invalid`: `const value = 0; values.filter(f)[value];` (same report as `[0]`) and `const myObject = { /** @deprecated */ recommended: null }; const key = 'recommended'; myObject[key];`. Add as `valid` for key comparison: `class Mx { set p1(val) {} get ['p1']() { return ''; } }`. For string arguments, test a template literal such as require(`foo`).

> We have at least one utility for this, `getStaticValue`.

> Just requesting changes on handling computed values.

## Match by declaration, not by name: confirm it's the real global

(15)

Any check on a callee, type, or method name (`Boolean`, `Map`, `Uint8Array`, `.apply`, `.call`) must confirm that the thing resolves to the global, not a user declaration or a coincidentally named member. Use the scope manager, type system, or helpers like `isGlobalDeclaration`.

Why: Folks do redeclare built-ins and define same-named methods, so a name-only check falsely reports or misapplies logic. It's not enough to just look at the name; the same applies to option specifiers, where the declaration's origin has to be checked too.

Verify: Add as `valid`: `class Map { value = 1; } const map = new Map(); Object.values(map);` and `interface Gotcha { apply(...args: unknown[]): void; } declare const gotcha: Gotcha; gotcha.apply(null, 'abc');`. Repeat with a local `function Boolean(value) {}` or `class Uint8Array<T> {}` for whichever global the rule names.

> It's not enough to just look at the name. If someone happens to redeclare their own class, such as `class Uint8Array<T>`, the rule should know to check that:

> [Bug] False report case:

## Cover the whole syntax family of the matched construct

(14)

Read the AST spec for each matched node and property, then cover its sibling forms: class expressions as well as declarations, computed and literal keys, `this` and qualified type names, members without type annotations, generators, and tuples.

Why: Rules commonly handle the first shape the author thought of. Odd forms are still valid code, and a user would consider the gap a bug.

Verify: Add cases such as `class Annoying { ['ab']() {} }`, `const _ = class { ... }`, `work(other: this)`, `interface I { property; }`, and `function* test(): Generator<number | string>`.

> This'll need to handle `this` and namespace types, no?

> Don't forget the other types of assignment expressions: `||=`, `??=`, `|=`, there may be more I'm not remembering.

## Treat `as` and `in` on AST nodes as signs of an unhandled case

(9)

For each `as`, `!`, or `@ts-ignore`/`@ts-expect-error` in a rule, remove it and read the compiler error. Handle the node shapes it names, or use a type predicate that states the real type.

Why: The TSESTree types represent all possible values of properties, so needing an `as` to compile means the code isn't handling some case. Casting a non-token node to a token is unsafe.

Verify: Delete the assertion, list the union members the compiler reports, and add a test for each reachable one, such as a computed or literal method key.

> The fact that an `as` was needed to get this code to type check means that the code isn't handling some case that it needs to handle.

> If a property (here, `id`) doesn't exist it's because the node legitimately might be a type that doesn't have it.

## Decide how a typed rule treats `any`, `unknown`, and `error` types

(7)

When a rule inspects types, consider what happens with an unresolved type. It acts as `any` but isn't one, so messages should say so, fixes should stay conservative, and test fixtures shouldn't reach it by accident.

Why: An error type gives a misleading report if it's described as a normal type, and a test using an undeclared name silently tests `any` rather than what was intended.

Verify: Add a case with an undeclared type, such as `declare const value: NotKnown | 0;`, and assert the message mentions the `error` type. Review test fixtures for names that aren't declared in the same case, like `const nullish = nullish;`.

> This doesn't mention the type as being an "error typed value" the way the other rules do.

> Is there a reason to allow `unknown`s? I would have thought that they should be warned on, since they're not guaranteed to be a `Promise`.

## Walk into unions, intersections, arrays, and tuples

(6; typescript-eslint)

In typed rules, confirm logic descends into union and intersection constituents and array and tuple element types, with recursion that terminates. Checking only the top-level type is a common gap.

Why: These shapes get hard to reason about, and tuples in particular tend to force implementation tweaks. Each has a clear way to skip into its parts.

Verify: Add tests for `A | B`, `A & B`, `T[]`, `[T]`, and a union nested in a tuple.

> Intersections (`T & T`) and unions (`T | T`): skip into constituent types

> Mostly requesting changes around adding unit test coverage for more edge cases, in particular tuples.

## Justify every exemption

(6)

For each `valid` test and each early exit that skips a syntax form, ask what the reason is. Skipping shapes such as computed access, optional variants, class instances, or non-identifiers needs a stated rationale, otherwise it's a false negative.

Why: We'd probably get a bug report from it not working. Exemptions are often based on a property that doesn't actually matter to the rule, and if a discovered edge case is truly debatable it should get an option instead.

Verify: For each exempted form, move the test to `invalid` and see whether anything justifies moving it back. Corpus examples: `void str['toUpperCase']();`, `([]?.filter(f))[0];`, `{ ...new A() }`, and `class A { constructor(b: 'c' | 'd') { this.b = b; } }`-style cases that an `Identifier`-only check skips.

> Why would this be exempted? `node.computed` is irrelevant here.

> Why not? This seems like it'd be a case folks would want to hit. We'd probably get a bug report from it not working.

## Resolve type parameters to their constraints

(4; typescript-eslint)

In typed rules, check what happens when the value's type is a type parameter. Using the original type instead of the constrained type is a repeat bug; if nothing useful can be known, skip it.

Why: Generics are a recurring source of rule bugs, and this class keeps coming back as new fixes.

Verify: Add tests with `function f<T extends string>(value: T)` alongside the concrete `string` case, plus an unconstrained `<T>`.

> Yet another case of needing to use the constrained type instead of the original type.

> Yeah I don't _love_ completely omitting checking for type parameters.

## Keep checking after one unhandled element

(4)

Look for `return` inside a loop over elements, members, or properties, and for `.every(...)` gating a whole-node report. One hole, rest element, unsupported member, or non-matching sibling shouldn't stop the remaining elements from being checked and reported.

Why: There can still be a violation next to the thing the rule can't handle, and users expect a report for each problem rather than just the first. Reporting per violating element also gives a smaller, more precise range.

Verify: Add as `invalid`: `function test([a, , b]: [boolean, number, object, string]) {}` (reports `string`), `function receive([value]: [string, ...string[]]) {}` (rest type unused), and `` const other = 'abc'; `before${'def'}middle${other}after`; `` (reports only `${'def'}`). For a loop, use two bad entries and expect two errors.

> There can still be an unused property even in the presence of empty slots:

> It's possible for a rest type to be unused. This rule should handle that.

## Report even when no fix can be produced

(4)

Check that fixer or suggestion limitations never gate `context.report`. Early returns for an unsupported shape or for nearby comments should only drop the fix, and fix-building logic should live inside `fix`.

Why: The code still violates the rule whether or not a fix is possible. Comments in particular are all over the place and on their own don't indicate a lint rule should be ignored.

Verify: Add as `invalid`, not `valid`: `if (foo) { /* comment */ foo.bar(); }`. For a rule with a suggestion, add a case the suggestion can't handle and assert the error is present with no suggestions, for example `declare const arr: unknown[]; declare const i: number | string; delete arr[i];`.

> The lint rule should still report even if it can't figure out a suggestion. This and the other `return;` cause it to bail out of both reporting and creating a suggestion.

> I think we should still report in this case. Folks put comments all over the place sometimes; on their own they don't indicate a lint rule should be ignored.

## Apply a change to every report path

(4)

When a rule has several message IDs or return sites, confirm that a new option, message change, or fixer reaches each one. Search for the message IDs and return shapes rather than trusting the path the PR touched.

Why: PRs tend to add a check in a couple of places but not all of them, which leaves one report path behaving differently, such as an option that doesn't apply to promise arrays or a fix on only one of two reports.

Verify: Run `grep -n "messageId\|isUnhandled: true" src/rules/<rule>.ts` and require at least one test per hit that exercises the change. Example `valid` case: `declare const arrayOrPromiseTuple: Foo<unknown>[]; arrayOrPromiseTuple; type Foo<T> = Promise<T> & { hey?: string };` with `allowForKnownSafePromises: [{ from: 'file', name: 'Foo' }]`.

> There's also a `unsafeComputedMemberAccess` message ID that's reported. I think that's missing in this PR.

> This PR right now adds the `allowForKnownSafePromises` check for a couple places, but not all of them.

## Don't report when the rule can't be confident

(4)

Where analysis gets murky, such as roughly invalid code or type parameters used as type arguments, prefer not reporting over guessing. Treat false positives as rule bugs, and say so in the review.

Why: If code is roughly not valid, the reviewer hesitates to feel confident in making changes. Silence is a safe starting point, and a bugfix can add the case later if users complain.

> If users complain we can add it as a bugfix later on - but if the code is roughly not valid, I'd hesitate to feel confident in making changes.

> dealing with type parameters being used as type arguments (for now, just not reporting)

## Keep results independent of unrelated code aspects

(4)

Check whether comments, semicolons, or file type change whether a rule reports or fixes. Restrict behavior only on what the rule is about, and leave file targeting to user config.

Why: Users really dislike it when aspects of code unrelated to a rule change how it works; a fixer that only works on uncommented code feels like a bug.

Verify: Duplicate a test case with a comment added and without semicolons, and confirm identical reports and fix availability.

> Users really, really dislike it when aspects of code unrelated to a rule change how that rule works.

> it'd be very confusing to users why adding a comment inside a type stops this rule from complaining on it.

## Detect types by behavior instead of hard-coding built-in names

(3)

Look for lists of built-in class names or checks that a member is the built-in declaration. Prefer checking how the type behaves, such as whether it has a callable `then`, so user-defined equivalents work.

Why: Users write their own classes like `Bluebird` or `CachingMap` and expect the same lint checks, and projects augment built-ins as `@types/node` does for `.at`.

Verify: Add a test with a user-defined class that behaves like the built-in and another with a project augmentation of the built-in.

> I'm not a big fan of hardcoding in built-in classes. Users tend to write their own with names like `Bluebird`, `CachingMap`, etc. - and expect the same kind of lint checks for them.

> We generally look at how types behave (`isPromiseLike`) if there isn't a built-in API.

## Check type flags with helpers, not `===`

(3; typescript-eslint)

Replace `type.getFlags() === ts.TypeFlags.X` and long hand-written type predicates with `tsutils.isTypeFlagSet`, and be deliberate about `Void` vs. `VoidLike` style flag groups.

Why: Flags are a bitmask, and odd edge cases with number literals vs. numbers have come up before. Exact equality misses them.

Verify: Run `grep -n "getFlags() ===\|\.flags ===" src/rules/<rule>.ts`. Test each type condition with both a primitive and its literal, such as `declare const i: number;` and `declare const i: 1;`. If swapping the flag for its `*Like` group fails no test, add one.

> Anywhere that checks type flags with a `===` should probably use a `tsutils` helper instead. We've seen odd edge cases with number literals vs. numbers before.

> You can use `tsutils.isTypeFlagSet` instead of this big name.

## Keep traversal state in a stack that tolerates nesting

(3)

Look for single variables or sets on the rule or class that are reset on entering a node, and for stacks that are read without considering emptiness. Nested classes, functions, and templates need per-level state, and code outside any function can still reach a visitor.

Why: Clearing shared state on each new class won't hold up for inner classes, and state flags don't scale when arbitrary nodes can be children. TypeScript may report a stray `return` as an error, but the linter may still run.

Verify: Add a nested case: `class First { constructor(public a: number) { class Second { constructor(public a: number) { this.a = a; } } new Second(0); this.a = a; } }`, including variants renaming either `a`. Add a top-level `return;` and assert that the rule doesn't crash.

> Clearing `parameterProperties` on each new class won't hold up for inner classes declared inside outer classes.

> I don't think any kind of state on `Converter` is going to scale.

## Resolve TODOs for unhandled syntax before merging

(3)

A new rule shouldn't ship with TODOs naming syntax it doesn't yet handle. Handle the case, or at least capture it in a test and decide explicitly that it isn't worth doing.

Why: Later support for the skipped constructs may be a breaking change, and a TODO hides whether the case is pending or abandoned.

Verify: Run `grep -nE "TODO|XXX" src/rules/<rule>.ts tests/rules/<rule>.test.ts`. Each hit needs a test (even a failing one to discuss) or a linked issue.

> Yeah we'll have to do something here to make this PR mergable.

> Can you include any test cases you're thinking of for them? Even if they're not passing right now, it'd be helpful to see.

## Don't assume a fixed parent depth

(2)

Flag `node.parent.parent` style checks and helpers named for a specific ancestor level. Type nodes can be nested and parenthesized to any depth, so ascend the AST in a loop or track whether traversal is inside the construct.

Why: Literals might be more deeply nested than two levels inside a parent, and parenthesized types or more nesting trip up the check.

Verify: Add `type Nested = ('' | ('' | (1)));` and `declare function fn2(): (never | 'foo') | 123;`. Both must behave the same as their flat forms.

> TS literals might be more deeply nested than 2 levels inside a parent:

> This function doesn't account for parenthesized types. This code trips it up:

## Don't hand-roll declaration or lib file detection

(2)

Flag `.endsWith('.d.ts')` and `lib.*.d.ts` filename matching. Declaration files also come as `.d.cts` and `.d.mts`, and filename patterns can match user files. Use `isDefinitionFile`, `isSymbolFromDefaultLibrary`, or `program.isSourceFileDefaultLibrary`.

Why: Suffix checks aren't exhaustive in one direction and get tricked in the other, and existing utilities already handle this.

Verify: Run the rule with `filename: 'file.d.mts'` and `'file.d.cts'`. For lib detection, declare a type in `./src/gotcha.lib.d.ts` and assert that it isn't treated as a default library type.

> This isn't exhaustive: DTS files could also be `.d.cts` or `.d.mts`.

> This will get tricked by types in files like `./src/gotcha.lib.d.ts`.
