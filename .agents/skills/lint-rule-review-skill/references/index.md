# Pattern index

Every pattern, most common first in each file. Skim this, then read only the sections that fit the change: each title is a `##` heading in its file, so search for it and read the dozen or so lines below it.

## bugs.md

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

## fixes.md

- Autofix only what keeps behavior and types; otherwise use a suggestion
- Keep fixes small and comments intact
- Prove fix output is valid and keeps operator precedence
- Ask whether each report can have a fixer or suggestion
- Make fixers edit only the tokens that change
- Give suggestions their own specific message
- Compute fix-only values inside the fix

## test-method.md

- Delete or flip each condition and confirm a test fails
- Resolve every uncovered line with a test or by deleting it
- Keep test cases granular: one behavior each
- Pair each behavior with valid and invalid cases
- Leave explanatory comments out of test cases
- Keep edge-case tests that already pass
- Assert exact, tight report ranges on the offending span
- Get tests in place before judging the implementation
- Write test cases by hand instead of generating them
- Run the rule on the repo and on real code, then reduce what you find
- Keep snippets valid and type-clean, using `declare` for typed values
- Require a test with every rule logic change
- Strip test code to what the case exercises
- Add near-miss valid cases one token away from a report
- Target new logic instead of re-testing existing logic
- Use plain template literals for test code
- Assert message data in errors
- Turn scenarios named in the issue or PR into tests
- Move test cases instead of deleting them

## test-cases.md

- Put comments and whitespace in every token gap
- Types: test every position that supplies a contextual type
- Nest the matched syntax one level deeper
- Types: test unions and intersections of the matched type
- Types: test every spelling of built-in collection types
- Types: test type operators and utility types
- Types: test `any`, `unknown`, `never`, `void`, and the error type
- Wrap matched nodes in redundant parentheses
- Test every way to spell a name
- Test every member of a node kind or operator list
- Test class and function expressions, not just declarations
- Test spread and rest forms
- Test each option off, on, and combined
- Types: test constrained, defaulted, and curried type parameters
- Test every call-like expression
- Test every enum shape
- Test every class member modifier and kind
- Test falsy and alternate numeric literals
- Test empty, missing, and single-item inputs
- Test several violations or uses in one target
- Test ambient contexts and namespaces
- Types: test inheritance chains and mixed heritage clauses
- Types: test overloaded signatures
- Test destructuring variants
- Test that same-named nested keys are ignored
- Test user-defined shadows and aliases of globals
- Test a name used in both type and value positions
- Types: test branded primitives
- Types: treat `this` parameters as a distinct parameter shape
- Types: test each nullish and void union combination
- Test multi-code-unit characters in text measurements

## simplification.md

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

## performance.md

- Run cheap AST checks before type information and expensive lookups
- Stop traversing once the answer is known
- Hoist invariant work out of per-node visitors

## design.md

- Keep unrelated changes out of a rule PR
- State the semver impact of each behavior change
- Place the rule in the right preset, staging big rules out first
- Widen the rule to everything its concept covers
- Use the shared specifier format for type and value allowlists
- Send out-of-scope expansions to followup issues
- Mirror the change across sibling rules and cases
- Make report messages coach instead of adding logic
- Keep options minimal, object-shaped, and strict in schema
- Ask whether the rule belongs in this plugin at all
- Check for overlap with other rules, flags, and options
- Justify each option with a real use case
- Start with the smaller rule and add surface on demand
- Keep extension rules in parity with the base rule
- Add an option where the rule would ban valid code
- Deprecate old rules and options instead of removing them
- Leave formatting concerns to formatters
- Decide up front whether the rule needs type information
- Check the reference rule's implementation when porting
- Avoid boundless or opinionated defaults
- Fix the root cause instead of working around it
- Keep rule meta in sync with what the rule does
- Judge the rule against the issue's purpose, not its algorithm
- Keep rule-specific logic out of shared and core code

## messages.md

- Make report messages say why the code is a problem
- Keep message IDs static, accurate, and few, using data for variation
- Reuse the wording of sibling rules and messages
- Read the rendered message as an end user would
- Keep full serialized types out of messages

## docs.md

- Ship and update docs with every rule, option, and behavior change
- Document every option: why it exists, its values, and paired examples
- Give When Not To Use It a concrete scenario, and targeted disables first
- Avoid prescriptive tone, absolutes, and words implying ease
- State exactly what the rule covers, and keep the page to that rule
- Keep snippets clean, few, and free of distractions
- Link authoritative external docs under Further Reading
- Define or replace jargon readers won't know
- Match sibling rules' format and the project's description wording
- Link TODOs, workarounds, and disables to an issue
- Backtick code terms everywhere
- Use the precise term, consistently
- Lead with essentials and move niche detail down
- Prefer short sentences, one per line
- Explain what the construct is and why it's a problem
- Don't repeat auto-generated docs content
- Call out surprising limitations and fallbacks
- Write descriptive link text
- Use lists and tables for parallel information
- Document only the delta on extension rules
- Strip LLM writing habits from rule docs
- Keep the old name findable after a rename
- Omit the bare-string type specifier form
- Label new or experimental rules on the page
- Use JSDoc for overviews without restating types

## naming.md

- Treat option names as public API: precise, consistent, lenient when enabled
- Name functions and helpers for exactly what they do
- Match the names and constructs already in the file or project
- Replace placeholder and abbreviated names
- Drop words already implied by context
- Insert into sorted lists in sorted order
- Proofread identifiers for typos and bad word splits
- Use the canonical `ts` namespace for TypeScript imports
- Name rules for precisely what they check
