# Performance

Ordered by how often this came up in past reviews. The number is rough weight, not a score.

## Run cheap AST checks before type information and expensive lookups

(19)

Order syntactic checks before type checker calls, and watch for manual traversals (such as `simpleTraverse`) or per-file graph building. Readability refactors can also move work into hot paths.

Why: Asking the type checker for anything can be slow, so AST comparison goes first. Reducing the amount of work done is a design goal for type-heavy rules.

Verify: Read each listener for type checker calls that run before a cheap syntactic bail-out.

> We'd want to do them in that order because asking the type checker for anything can be slow.

> Generally, asking for type information is the most performance-expensive part of rules.

## Stop traversing once the answer is known

(10)

Check loops and tree walks for a point where the result can't change. Bail out once a threshold is reached, return truthy from `forEachChild` to stop it, use `.some` over `.every` where valid, and walk up from a node via parents rather than down through all children.

Why: Continued iteration keeps paying for calls such as `getStart()`, and recursing down into a node with many children can take a lot of time. A traverser that can't break is the wrong tool.

> If `numExplicitUses >= 2` then we can bail out of the loop for the `typeParameter`.

> That means we can bail out of the loop early as soon as a match is found.

## Hoist invariant work out of per-node visitors

(7)

Look for `new RegExp`, constant arrays, closures, and option normalization inside visitors or nested functions. Static values go at module scope; values derived from options go at the root of `create()`, normalized once.

Why: Work repeated per node or per dependency multiplies; a config with many patterns creates many regexes for no reason.

Verify: Confirm the value depends on nothing narrower than the options, then move it.

> This re-runs the `new RegExp` on each `switch` statement.

> any particular reason to put this inside the `ExportNamedDeclaration` function? It could go above the `return` to only have to be called once.
