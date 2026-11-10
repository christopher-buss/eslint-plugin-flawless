# Simplification

Ordered by how often this came up in past reviews. The number is rough weight, not a score.

## Contents

- Move shared logic into one utility instead of copying it
- Delete comments that restate the code
- Drop guards for states the AST or earlier code rules out
- Delete any code that no test requires
- Reduce conditions to the smallest equivalent expression
- Use existing APIs instead of hand-written checks and caches
- Use concise modern syntax and array helpers
- Encode guaranteed node shapes in types, not narrowing guards
- Weigh added lines against the rule's responsibilities
- Let selectors and visitors do the structural work
- Use optional chaining exactly where it is needed
- Inline premature abstractions and speculative types
- Remove annotations and arguments TypeScript can infer
- Give AI-assisted rule code a discerning simplification pass
- Skip locals that only alias a property or are used once
- Extract long inline logic into named functions
- Simplify helper signatures to what callers provide
- Use public APIs and avoid TypeScript internals
- Don't redo what a helper or earlier branch already handles
- Prefer plain, conventional code over clever code
- Remove commented-out code and leftover notes
- Prefer const expressions over `let` assigned later
- Return early instead of nesting
- Merge redundant state into one source of truth
- Use Set or Map lookups instead of predicates and linear scans
- Compute a repeated value once
- Omit meta fields that restate defaults

## Move shared logic into one utility instead of copying it

(58)

Before accepting a nontrivial helper, grep the `util` directory and sibling rules for the same logic, such as `getStaticStringValue`, `skipChainExpression`, `getWrappingFixer`, or `isBuiltinSymbolLike`. If it exists, reuse it; if it is copied, move it to a util, and switch older call sites to it.

Why: This need comes up a lot in rules, so nontrivial logic should live in one place. New helpers should also replace existing code doing the same checks, or they sit beside duplicates.

Verify: Grep the plugin for the helper body's distinctive calls. After reuse, run tests for every rule touched.

> This is directly copied from `return-await`, right? Since it's a nontrivial function I think it'd be best to put in a util file and re-use between the two rules.

> I like the logic and am mostly requesting it be moved into `type-utils` so that all rules can benefit from it.

## Delete comments that restate the code

(38)

In rule source, remove one-line comments and JSDoc `@param`/`@returns` tags that repeat what names, types, and context already convey. Keep comments that add information the code doesn't show.

Why: They don't add anything, they're apparent from the name and context, and they're not worth keeping up to date. A type predicate's `@returns boolean` is less information than the signature.

Verify: For each comment, delete it and ask whether nearby names and types still convey the same information.

> Nit: I don't think these comments add anything. They're all pretty apparent from the name & context.

> a lot of these comments are pretty self-apparent from the code IMO.

## Drop guards for states the AST or earlier code rules out

(34)

Flag `node.parent?.`, `!x` checks, `?? []`, `Array.isArray(options)`, and `.length` pre-checks on values that callers, selectors, `defaultOptions`, or the AST already guarantee. Trace the call sites before keeping one, including guards added only to satisfy `noUncheckedIndexedAccess`.

Why: Defensive checks for impossible states confuse readers about what can actually happen. Where the type system can't see the guarantee, a `!` or restructuring beats a branch that can never run.

Verify: List every caller of the helper and confirm what each has already narrowed, then remove the guard and run the tests.

> we humans know `node` always has a `parent`, so the type system is wrong to suggest it could be `undefined`:

> If `node.parent.type === AST_NODE_TYPES.CallExpression` then we know `node.parent` exists:

## Delete any code that no test requires

(24)

For each guard, branch, `?.`, or helper in the rule, ask what fails if it is removed. If nothing fails, it is either dead code or an untested behavior, and the PR must resolve which.

Why: Passing tests after a deletion mean one of two things: a unit test is missing or the code is dead. Either the code goes, or a test proves why it stays.

Verify: Delete the line, or change the `if` to `if (true)`, then run the rule's tests. If they stay green, add a failing test case or keep the deletion.

> No tests fail from removing the `?`. Either a unit test is missing or this is a teeny bit of dead code:

> For this and my other "dead code" notes: if I'm wrong, we should have unit tests proving it.

## Reduce conditions to the smallest equivalent expression

(23)

Look for if/else ladders, `a && b` pairs, and accumulator variables that collapse into one expression: `??`, `?.`, `!x?.length`, or comparing two booleans with `===`.

Why: The reduced form often reads closer to what the code is trying to do, and it exposes logic that was never needed.

Verify: Run the existing tests after rewriting; the rewrite must be behavior-preserving.

> The current code was a little confusing to me at first. But it actually reduces down nicely:

> any reason for the double-nesting?

## Use existing APIs instead of hand-written checks and caches

(21)

Flag bitwise `type.flags & ...`, `as ts.ObjectType` casts, manual union recursion, and paired per-kind checks. Use `tsutils.isTypeFlagSet`, `isObjectFlagSet`, `isObjectType`, `typeParts`, `isLiteralType`, and `isIntrinsicErrorType`, and pass OR-ed flags in one call rather than checking each flag separately.

Why: The library already covers these cases with fewer characters and more type safety, so a local reimplementation is extra code to maintain.

Verify: Search the rule for `.flags &`, `.objectFlags`, and `.isUnion()` followed by recursion, then look up the equivalent ts-api-utils export.

> Fun fact, `ts-api-utils` has a `typeParts` function for just this!

> I've seen this "make a Map for a single cache" pattern a bunch, I made a [`cached-factory`](https://www.npmjs.com/package/cached-factory) package for it.

## Use concise modern syntax and array helpers

(19)

Rewrite `x && x.type === y` as `x?.type === y`, `a = a || b` as `||=`, `if (!a) a = b` as `??=`, `.map().flat()` as `.flatMap()`, and `arr[arr.length - 1]` as `.at(-1)`.

Why: A teeny bit less code, and flatMap avoids a later `.flat()`.

Verify: Enable prefer-optional-chain, logical-assignment-operators, and unicorn's flat-map and at rules.

> Nit: Just a teeny bit less code...

> I'm surprised this isn't caught by https://typescript-eslint.io/rules/prefer-nullish-coalescing ...

## Encode guaranteed node shapes in types, not narrowing guards

(18)

When a rule uses `nullThrows`, `/* istanbul ignore */`, `'x' in node`, or an unreachable `return` because a type is too wide, narrow the type instead: restrict the parameter, use `MakeRequired<T, 'field'>`, add `{ parent: ... }`, or use an `as` assertion as a fallback.

Why: Unreachable code is usually a sign the types don't match reality and are pressuring you to write code you don't need. If the AST types are too loose, fix those.

Verify: Remove the check, tighten the type, and run `tsc`. Coverage ignores should disappear with it.

> Unreachable code is often a sign that the type system isn't matching reality, and pressuring you to write code you don't need to.

> If the reason it's here is to narrow `argNode`'s type down to `TSESTree.Expression` then maybe either the types are suggesting a legit case to handle, or are wrong?

## Weigh added lines against the rule's responsibilities

(16)

Look for ways to reduce added lines in large rule files. Bring specific counts or targets where possible; net code removal with tests still passing is the best outcome.

Why: Lean code is easier to read and review, especially in rules that are already a lot of lines. Code removal reliably earns praise.

Verify: Compare `git diff --stat` before and after, with tests passing.

> We should be able to trim the changes down a bit to be easier to read & review.

> Adding 175 lines of new code to an already-large rule to support fixing outside the rule's responsibilities is... a lot.

## Let selectors and visitors do the structural work

(13)

Replace in-handler operator or parent checks with an esquery selector, replace flags set during traversal and read at `Program:exit` with a direct check on the parent node, drop `:exit` when ordering no longer matters, and prefer a node-type visitor to manual recursion from a catch-all `SourceFile`. Watch descendant versus child combinators.

Why: Waiting until the end adds more complexity than needed when the property is a known child. The selector also states the rule's scope and avoids nested-function edge cases.

Verify: Test nested-scope cases, such as a `function` inside a constructor, when changing a descendant selector to a child one.

> This _"wait until the end"_ strategy adds a bit more complexity than we need.

> It succinctly filters away undesirable node shapes that this rule wouldn't want to check for

## Use optional chaining exactly where it is needed

(10)

Replace `x && x.y === z` and `!x || !x.y` with `x?.y`. Conversely, remove `?.` after a check has already proven the value exists, such as `node.parent?.type === ... && node.parent?.body`.

Why: It is more succinct, and the reviewer is often surprised lint didn't flag it. When a chained value compares as defined, its object is known to exist.

Verify: Run @typescript-eslint/prefer-optional-chain and no-unnecessary-condition on the rule.

> Nit, I'm surprised this wasn't flagged by linting:

> This would be a bit more succinct, I think.

## Inline premature abstractions and speculative types

(10)

Remove one-line wrappers like `isString`, predicate parameters with a single kind of caller, intermediate variables used once, and structures separating values that are consumed identically. Wait for an actual need.

Why: A straightforward `typeof` in place is fine. Extra generality is more complexity than the code needs today.

Verify: Replace the type with the plain form and run tsc: no new errors means the specificity was unused.

> I don't think we need such a straightforward function. Just a `typeof` in-place is code is fine.

> We can always expand to more cases later. But in the meantime it's extra cognitive complexity for a feature we aren't 100% likely to need.

## Remove annotations and arguments TypeScript can infer

(9)

Flag explicit return types on non-exported functions, explicit generics on `createRule` or helpers, annotations on constants, unneeded `as const`, and listeners split out so that `node` must be annotated. Contributors have pushed back on this for exported functions, so treat it as a preference.

Why: Non-trivial annotations take up a lot of syntax space and make code a little harder to read, and TypeScript reports any mismatch anyway. typescript-eslint stopped enforcing explicit return types for non-exported functions.

Verify: Delete the annotation and run tsc --noEmit: no new errors means it was unnecessary.

> we haven't enforced explicit return types for non-exported functions in a while. Non-trivial ones like this union with a deep object take up a lot of syntax space

> No need to explicitly declare those type arguments

## Give AI-assisted rule code a discerning simplification pass

(8)

In generated-looking code, look for the reviewer's recurring tells together: explicit return types, property-capturing local variables, and separate `if` statements that could be one condition. Ask about authorship kindly or not at all: one author said the variable was their own habit and the reviewer apologized.

Why: The reviewer should not be able to tell code was AI-authored, and removing these is manual work that lands on the reviewer.

> I can tell this is probably authored with AI. I should not be able to. Please apply a more discerning eye to the code.

> I'd recommend doing a pass to remove unnecessary type annotations, variable closures, etc.

## Skip locals that only alias a property or are used once

(8)

Flag `const parent = node.parent;`-style aliases and variables used once on the next line. First check whether the variable exists for TypeScript narrowing, which is a legitimate reason: the reviewer retracted this comment once for that, and elsewhere recommended a variable to keep a narrowed type inside a closure.

Why: The pattern isn't worth the extra line and is a little verbose compared with using the original property. The reviewer wants a lint rule against it.

Verify: Inline the variable and run tsc: if narrowing breaks, keep the variable.

> this _"store a single property in a variable"_ pattern isn't really necessary; I don't think it's worth the extra line.

> Why bother making the variable if it's only used once, on a next line?

## Extract long inline logic into named functions

(8)

When a block of `let` declarations is assigned once, or dozens of lines in the middle of a function or file do a separate job, extract a function that returns the result and name it for the job.

Why: Rules that are long for a first version are hard to read through, and `const` results of a named function make it clearer what is going on.

> This file is already pretty big & chonky to understand.

> But they are an indication IMO that a well-named function could clear up the code instead, too.

## Simplify helper signatures to what callers provide

(8)

Flag boolean parameters that change a function's core behavior, mutually exclusive parameters, single-property option objects, and parameters always called with every value. Split the function, take one input, or have it handle both cases in one call.

Why: Boolean parameters make a function's responsibilities hard to track, and mutually exclusive inputs aren't easily representable in TypeScript.

Verify: Narrow the parameter type and confirm assertions inside the function can be deleted.

> I'm not generally a fan of adding boolean parameters to modify core behavior of a function.

> we know `createPropertyKeyFixer` is only ever called with a `TSESTree.TSAnyKeyword`.

## Use public APIs and avoid TypeScript internals

(7; possibly stale: confirm against current code; typescript-eslint)

Prefer direct, public APIs over workarounds. Treat type assignability checks as high risk: they need extra review, and their internal status may have changed since these comments.

Why: Assignability APIs have been reverted after reaching production, so a rule that depends on them needs more than one maintainer's review.

Verify: Remove the augmentation and confirm the rule compiles against public TypeScript types.

> This LGTM, but given how dangerous it is we should definitely also get review from @bradzacher and @kirkwaiblinger if they have time.

> We try very hard not to use TypeScript-internal APIs in our rules.

## Don't redo what a helper or earlier branch already handles

(7)

Check whether a new condition is already covered by a function it calls, an earlier branch, or a later catch-all. Pass a found value in as a parameter instead of re-finding it, and fold a check repeated before every call into the callee.

Why: Doing the same search or check in two places lets them drift, especially as the logic gets more complex.

Verify: Remove the redundant check and run the tests; reorder branches if one call can serve both paths.

> This should have already been found by `getSwitchMetadata`.

> `getComputedPropertyDeprecation` is already being called in `getDeprecationReason`, just after the `getCallLikeDeprecation`.

## Prefer plain, conventional code over clever code

(6)

Flag constructs that took effort to read: clever automation, type-level tricks, general names like `key` or `iterator`, and mixed idioms for the same thing, which also tend to mark AI-authored code.

Why: Clever code has a difficulty cost for readers, and these rules are maintained for a long time. Most TypeScript developers won't understand elaborate type shenanigans.

> ...but like many clever code things, there was a difficulty cost of reading it at first.

> My only concern is that these types of types shenanigans can be unapproachable or complex to work with.

## Remove commented-out code and leftover notes

(6)

Scan new rule files for commented-out code, personal notes, and fragments left from copying.

Why: Old commented-out code tends to get out of date and makes the file harder to read through.

Verify: Search the diff for `//` lines containing code.

> Are these leftover from somewhere?

> Was this meant to indicate something? Or should it be removed?

## Prefer const expressions over `let` assigned later

(6)

Flag `let` variables given a placeholder value and overwritten, booleans set inside an `if`, and shared accumulators outside a loop. Try a `const` with a ternary, destructuring, or a direct boolean expression.

Why: A `let` confuses the reader and tends to duplicate logic, and placeholder values like `-1` are unnecessary if they are always overridden.

> The `let` variable confused me a bit - there are a few points of duplication in the code.

> Setting the values to `-1` is unnecessary because they're always overridden later.

## Return early instead of nesting

(5)

Look for deep `if` nesting, `else` after `return`, and large conditions that could be guard clauses. In the reviewer's words: invert if, reduce nesting. If the author has a real preference for nesting, let it go.

Why: Returning as soon as possible makes it clearer what's going on and avoids more indentation. The reviewer drops this when an author actually has an opinion.

> I used to use the phrase _"invert if, reduce nesting"_ more in PR reviews. Now I'd rather make a lint rule for it

> In general, I think it's preferable to `return` as soon as possible. A bit clearer what's going on in the code.

## Merge redundant state into one source of truth

(5)

Look for two variables or fields where one is derivable from the other: paired booleans, a boolean alongside a nullable value, a field that is a `flatMap` of another, or an object used only to build an array. Keep one, using a union type where variants exist.

Why: If one value being truthy implies the other, the code is using two variables to store a single piece of info, which is a code smell for duplicate state.

Verify: Delete one variable, derive it from the other, and confirm tests pass.

> So this is using two variables to store a single piece of info.

> That's a bit of a code smell for duplicate state.

## Use Set or Map lookups instead of predicates and linear scans

(5)

Replace chained `===` name checks, `.find` over `Map` entries, and predicate-array schemes with a `Set` and `.has`, a `Map` keyed by what is being looked up, or a name-to-flags object. Don't widen a helper to a predicate if every caller passes a fixed set of names.

Why: A Set says more clearly what is happening, and keying the Map on the compared value turns an O(N) search into a single O(1) lookup.

> I think it'd be a lot simpler to move those names into a `Set<string | undefined>` and use `.has`

> Then we can do a single O(1) lookup!

## Compute a repeated value once

(3)

Look for the same function call or regex execution repeated with the same inputs in adjacent code. Store the result and reuse it, and use capture groups rather than running a second regex.

Why: Duplicate calls add noise even when the performance effect is negligible.

> Nit, since we're calling the same function twice ~

> Instead of duplicating the function call, we can more directly check the `?.value` in the `if`:

## Omit meta fields that restate defaults

(3; typescript-eslint)

Remove `requiresTypeChecking: false`, `extendsBaseRule: false`, `hasSuggestions: false`, and similar falsy meta properties.

Why: Falsy is their default, so stating them adds nothing.

Verify: Delete the property and confirm rule behavior and generated docs are unchanged.

> It's fine to leave this out; falsy is its default.

> Nit: this is the default.
