# Rule design and scope

Ordered by how often this came up in past reviews. The number is rough weight, not a score.

## Contents

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

## Keep unrelated changes out of a rule PR

(27)

Look for lockfile churn, editor settings, whitespace rewrites, stray scripts, or shared-logic edits that the rule does not need. Ask for them to be reverted or split into their own PR.

Why: Unrelated changes make it harder to see what is changing, and big PRs are harder to review.

Verify: Read `git diff --stat` against the base branch and justify every file outside the rule, its tests, its docs, and its registration.

> Lots of unexpected changes in this file - could you please revert them?

> We try to keep PRs single-purpose so it's easier to review them and easier to determine when bugs or fixes were introduced.

## State the semver impact of each behavior change

(20)

Classify the change: bugfix, feature, or breaking. New reports in a small-to-medium set of cases aren't breaking; changed defaults and removed options wait for a major. Make the PR title match.

Why: Pretty much any logical change to a lint rule could be seen as breaking, so the line has to be drawn deliberately. Type prefixes show up differently in the changelog and have different version bump implications.

Verify: Check `meta.docs.recommended` on a new rule against the target release. For deprecations, confirm the rule has left generated configs. Confirm each case requested in the issue is covered or has a test.

> Pretty much any logical change to a lint rule could be seen as a "breaking" change.

> Unfortunately, adding to the _recommended_ rulesets is a breaking change. This'll have to be relegated to _strict_ until the next major version.

## Place the rule in the right preset, staging big rules out first

(14; possibly stale: confirm against current code)

Check the rule's recommended level or preset. Opinionated rules stay out of defaults, additions to `recommended` are breaking while `strict` may grow in minors, and Flint rules that need no type information belong in `untyped` rather than `logical`.

Why: Many folks would be irked by opinionated rules on by default, and changing the `recommended` rulesets is a breaking change.

Verify: Compare with the preset of the closest existing rule, for example `no-throw-literal` for promise rejection rules.

> Making changes to the `recommended` or `recommended-requiring-type-checking` rulesets are breaking changes, but `strict` is fine to make any time.

> I think a gradual rollout to let folks try it will make sense

## Widen the rule to everything its concept covers

(13)

Ask what else is the same problem as the case the PR handles. A rule on functions may need variables, classes, interfaces, type aliases, and namespaces; a rule on strings may need `number` and `bigint` literals.

Why: A narrow first draft reads clean but leaves functional gaps. Being more comprehensive in which types and constructs it accounts for avoids a slew of edge case bugs.

Verify: List every syntax or type form that can express the reported concept, and add a test for each.

> I think it'll need to be expanded to at least variables. Really, anything that can refer to a type: classes, interfaces / type aliases, namespaces, ...

> I think the only blocker (other than reverting unrelated changes) is also reporting on unnecessary non-string literals such as `bigint` and `number`.

## Use the shared specifier format for type and value allowlists

(13)

If an option names types or values, use the shared `TypeOrValueSpecifier` format rather than a bespoke string list, and test all sources: file, lib, and package. Bare type-name allowlists are discouraged.

Why: A standard format lets rules specify type locations the same way, but it's widely used and tricky, so changes to it deserve extra review eyes.

Verify: Test the option with one specifier of each `from` source.

> The more we use the shared _TypeOrValueSpecifier_ format the more review eyes we'll want on it.

> The actual value for `.allow` is the `typeOrValueSpecifiersSchema` value from type utils:

## Send out-of-scope expansions to followup issues

(10)

When a PR grows past its backing issue, or a discussion finds a new class of cases, split it out. Only regressions and in-scope gaps should block; adjacent feature support gets its own issue.

Why: Single-purpose PRs get improvements in sooner without being blocked by bigger discussions. Tricky logic is delicate to expand, so go with what's working and let folks file a follow-up.

> Let's ignore interfaces in this PR altogether. Adding support for them in the rule would be a separate issue.

> IMO it'd be best to go with what's working now, and let folks file a follow-up if they really want.

## Mirror the change across sibling rules and cases

(10)

Ask if the same fix applies to sibling rules, and if parallel cases in the same rule behave alike. If one case gets a fixer or check, the mirror case probably should too. Follow how the area already does it.

Why: It would be odd for users if only one of two equivalent cases gets a fixer. Existing conventions should hold unless there's a strong reason to deviate.

Verify: Search for rules in the same family and compare their handling of the changed case.

> I also am thinking - should a similar fix be applied to the other `any*` rules?

> I do think it would be odd for users if the other case didn't also get a fixer though.

## Make report messages coach instead of adding logic

(10)

Review message text as part of the rule's design. If the rule branches a lot to pick an exact message, try fewer messages with better guidance. Check for copy-pasted text, extra lines, and vague wording.

Why: Rules can try harder than they need to to give the right errors. Less logic and more coaching in the messages can be more accurate and precise for users.

> With a bit less logic & a bit more coaching in the messages, I think it'll be more accurate & precise for users.

> I think the only blocker for me is the removing the second line of the `this` messages - WDYT?

## Keep options minimal, object-shaped, and strict in schema

(10)

Remove schema properties the rule never reads. Question options nobody would turn off. New options go in an object rather than array-style strings, and a boolean should default to `false` with a name to match.

Why: Truthy defaults for unspecified values get confusing, and needing a table to explain options is a symptom of unclear options.

Verify: Pass a misspelled option in a schema test and confirm config validation fails.

> I'm not a fan of truthy defaults for unspecified values.

> Inline array/string options are nice and succinct but don't scale well when other options get added in.

## Ask whether the rule belongs in this plugin at all

(8)

Before reviewing the code, decide if the rule should ship here. Look for whole-project analysis that can't be made performant, a heavy new dependency, an existing third-party rule, a frozen stylistic category, or a target that modern projects no longer hit.

Why: A useful rule can still be a bad fit: it may be better iterated on in a separate plugin, not bound by the project's limited flexibility and staffing. Rules included by default have to stay relevant.

> think this rule would be better off in a separate plugin from typescript-eslint for now

> I think this should be in a separate plugin, actually.

## Check for overlap with other rules, flags, and options

(8)

Look for double-reporting within the rule, option groups that match the same thing, and existing coverage from a third-party rule or compiler flag. Ask if the behavior is still needed given those.

Why: Overlap means duplicate reports or behavior that's no longer worth carrying. An allowance that predates a compiler flag may not be as good as it used to be.

Verify: Add a test that hits two code paths or two option groups at once and assert exactly one report.

> I think the direction is good - but the two new sub-groups shouldn't have overlapping matches, no?

> That's not for this rule to say. Ignoring unused property accesses is in the realm of

## Justify each option with a real use case

(8)

Question options in a rule's first version, especially granular per-case booleans or ones not agreed on in the issue. Without a known use case, leave them out and add them later on request.

Why: They're added complexity for a rule that hasn't been tried in the real world, and an option can always be added in a followup.

> Why allow such a granular set of options? Is there a known use case where someone would want to skip, say, only `Object.values`?

> If it's enabled, this rule will do nothing. So why include it at all? Users can always disable the rule.

## Start with the smaller rule and add surface on demand

(7)

For a first version, question each option, nuance in suggestions, and speculative branch. If nobody has asked for a behavior, drop it and let users request it later.

Why: Options and nuance cost code and review time. Users can always feature request an option, and a pre-1.0 or unreleased project has no need to keep things around for compatibility.

> For an initial version of the rule, I think nuance around suggestions aren't necessary.

> I'm strongly leaning towards simplifying it a bit by removing the `withFix` check - what do you think?

## Keep extension rules in parity with the base rule

(7; typescript-eslint)

For an extension rule, confirm it supports every option and sub-option of the base rule, reuses the base rule's listeners instead of reimplementing them, and adds only TypeScript-specific behavior.

Why: No major new functionality goes on top of base rules; that request belongs in ESLint core. Reusing the base rule can cut a lot of added lines.

Verify: Diff the base rule's schema against the extension's schema, and port the base rule's tests.

> I took a quick initial pass and think there should be an option added to maintain parity with ESLint core.

> We don't add any major new functionality on top of base rules here.

## Add an option where the rule would ban valid code

(7)

Look for cases where the rule reports a legitimate pattern that some users will want, or where a sibling rule has an equivalent option. Ask if the behavior should be opt-in or configurable rather than universal.

Why: It's not a linter's place to tell people not to use a totally valid pattern of code. A rule that can't be scoped ends up too opinionated and too restrictive to enable.

> It's IMO not our place as a linter to tell people not to use a totally valid pattern of code like that.

> Just requesting changes on the missing `"allow-as-parameter"` equivalent.

## Deprecate old rules and options instead of removing them

(6)

When a rule or option is replaced, keep the old one working and mark it deprecated rather than deleting it in a minor. The exception is a project with no real users yet.

Why: Keeping legacy options makes a change non-breaking, deprecation itself isn't breaking, and removing functionality is disliked even when technically allowed on 0.x.

> Keeping the legacy options around to make this non-breaking seems reasonable + necessary to me.

> We're on 0.x so technically we can do whatever we want... but as a nicety for users I do like keeping the old one around for a while.

## Leave formatting concerns to formatters

(5)

Flag rule or fixer code that exists to preserve whitespace, blank lines, or redundant parentheses, and rules that report purely stylistic points. Parentheses only matter when removing them or keeping them causes a syntax error.

Why: Whitespace code tends to be verbose and hard to maintain. A slightly worse formatted autofix is better than hundreds of lines of code, and users who care should use a dedicated formatter.

Verify: Delete the whitespace-preserving branch; fix output should still parse, even if it is uglier.

> It's better to have a slightly worse formatted output from an autofix than to have to maintain many -often hundreds- of lines of code.

> We generally don't try to put effort into rule fixers towards respecting nuances of original source file formatting.

## Decide up front whether the rule needs type information

(5)

Ask if a syntactic rule is really correct without types, and whether a typed rule needs them. Options must fit that choice: an untyped rule can't take a format that requires type information.

Why: This choice changes the rule's correctness, its cost, and which options are possible, so it should be settled with the team before polish.

> Unless someone in @typescript-eslint/triage-team disagrees with me, I think we'll want type checking in the rule?

> Adding a TypeOrValueSpecifier ignore option is out-of-scope because that format requires type information. This rule isn't typed right now.

## Check the reference rule's implementation when porting

(5; flint)

When a Flint rule ports an ESLint rule, compare it with the original source, docs, and tests. Look for prior art for scope handling, token lookup, and reference tracking before writing custom logic.

Why: Ports have repeatedly been simpler and less reliable than their reference implementations, which already solve shadowing, comments, and modifying references.

Verify: Read the ESLint rule's tests and confirm each behavior has an equivalent Flint test.

> Take a look at the reference rule docs, source, and tests from ESLint, and fill out this rule.

> Refactor to check the actual nodes/tokens, the way e.g. the ESLint rule does

## Avoid boundless or opinionated defaults

(5)

Challenge any default allowlist of specific types, and any default that makes the rule lenient. Ask where the list ends, and whether a user on default options would be confused that only some types work.

Why: Core rules should avoid 'boundless' defaults and shouldn't put forward opinions on which types match an option. Empty is usually the right default.

> One of the rules of thumb for core lint rules is to avoid "boundless" defaults.

> We generally try not to put forward opinions like which internal types do or don't match up with specific rule options.

## Fix the root cause instead of working around it

(5)

Treat these as smells: an `as` needed to call a shared helper, synthesized AST nodes, hardcoded special cases for a runtime or package, and comments saying "for some reason". Change the helper, handle the node natively, or fix the underlying bug.

Why: Workarounds use general functions against how they are meant to be used and are brittle to AST changes. Unexplained behavior should be hammered out before merge.

> I think the fact that this needed an `as` assertion indicates the new code is trying to work around how things are meant o be used.

> Synthesizing nodes is a rather unusual practice. It's brittle to changes in AST and AST handling, as well as verbose.

## Keep rule meta in sync with what the rule does

(5)

Check that `fixable` is set only when a rule has a `fix`, suggestion flags only when it provides suggestions, and that every declared message ID is used.

Why: A rule that only has suggestions isn't "fixable", and leftover message IDs or `suggestion: true` misdescribe the rule.

Verify: Enable eslint-plugin-eslint-plugin's require-meta-fixable, require-meta-has-suggestions, and no-unused-message-ids on the rule.

> The rule isn't "fixable", it just has suggestions.

> This rule doesn't make suggestions in its reports.

## Judge the rule against the issue's purpose, not its algorithm

(4)

Compare behavior to what the backing issue asks for and what the rule says it does. An implementation detail, such as counting references, doesn't justify an outcome that contradicts the rule's purpose.

Why: A PR can pass its own tests while heading in a different direction from the issue. If code conflicts with the rule's general purpose, that's a conceptual bug in the algorithm.

> I interpreted the counting as just an implementation detail. The rule's general purpose is to flag unnecessary type parameters.

> I think the direction here might be a big different from the issue?

## Keep rule-specific logic out of shared and core code

(4)

Check whether a rule PR adds rule- or language-specific behavior to core packages, shared utilities, or a global test file. Move it to the rule, its tests, or the language package, and have core expose only general capabilities.

Why: Core should give rules what they reasonably need without knowing about any one rule. Shared logic changes are separate issues and PRs.

> There should never be any rule-specific logic in core.

> Hmm, we normally put rule-specific things in each rule's specific test files.
