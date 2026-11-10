# Test quality

Ordered by how often this came up in past reviews. The number is rough weight, not a score.

## Contents

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

## Delete or flip each condition and confirm a test fails

(95)

For every `if`, `&&` operand, selector prefix, and `.some`/`.filter` callback in the rule, ask whether removing or flipping it fails a test. If nothing fails, either a test case is missing or the code is dead.

Why: The reviewer pulls the branch and mutates lines by hand. A guard no test depends on is either an untested behavior or unnecessary code, and each surviving mutant usually points at a concrete missing case.

Verify: Mutate one condition at a time (`if (x)` to its body only, `.some` to `.every`, `filter(fn)` to `filter(() => true)`, `return false` to `return true`), rerun the rule's tests, and require at least one failure. Turn each surviving mutant into an adversarial test case or delete the code.

> No tests fail if this is changed to `.every`. I think that means there's some logic being missed?

> I tried removing this added check locally and no unit tests failed. Either the check is unnecessary or there's a bag in unit test coverage.

## Resolve every uncovered line with a test or by deleting it

(41)

Treat every line that coverage reports as missed or partial as a decision: if it is reachable, add a test; if it isn't, remove it or use a refactor or type assertion. Code shouldn't be left as an untested fallback.

Why: Everything should be tested. A branch that can't be hit is dead code, and a branch that can be hit but crashes or misbehaves is an untested bug.

Verify: `pnpm run test run --coverage` and open `coverage/index.html`, or read the Codecov report on the PR. Require no red or yellow lines in the rule file.

> this is code that can be hit, and a test should be added

> These lines are unhittable and can be removed

## Keep test cases granular: one behavior each

(32)

Each `valid` or `invalid` entry should exercise one behavior. Flag cases with several declarations or calls in a snippet, several `errors` entries from different behaviors, or a single test with sequential arrange-act-assert groups.

Why: Granular tests give more precise failures and are easier to read and debug. A test runner shows only the first failure of a case, and mismatched errors are easy to miss in a large snippet.

Verify: Split a case until each snippet has one thing under test. A test with several unrelated `errors` entries should become one test per error.

> One thing under test per case please

> such as having one behavior under test per test case

## Pair each behavior with valid and invalid cases

(18)

For each new behavior, option, or syntax kind, look for a case on both sides. PRs commonly add only `invalid` cases for a new report or only `valid` cases for a false-positive fix.

Why: An `invalid`-only test can't show the rule avoids false reports, and a `valid`-only test can't show the rule still complains when it should.

Verify: For each changed code path, list one `valid` and one `invalid` entry that goes through it. For a false-positive fix, also add `invalid` cases showing the rule still reports nearby code.

> Normally we'll want both `invalid` and `valid` cases added. This just adds `valid`.

> These new test cases do a great job of testing _invalid_ code (where the rule should report) for namespace imports. But there isn't anything checking _valid_ code

## Leave explanatory comments out of test cases

(15)

Remove section comments, `#region` markers, and explanatory labels from test files when the case's code makes its purpose clear. Keep one only when a test really isn't clear.

Why: Comments aren't enforced to be correct and drift from the tests over time. Tests should be straightforward enough to understand by reading.

Verify: Review comments added inside `valid` and `invalid` arrays in the test diff.

> We don't generally include comments / test names like this. The tests should be straightforward enough that you can infer the names from reading them.

> we generally don't put many comments in tests that can be inferred from the tests themselves. They have a bad habit of getting out of date over time.

## Keep edge-case tests that already pass

(13)

Don't drop an edge case because the rule handles it today. If the logic looks fragile or the area is a known source of breakage, the case belongs in the file as a regression guard.

Why: The reviewer asks for these to future-proof the rule, since edge cases creep in later and refactors break what worked.

Verify: When an adversarial case passes on the first try, keep it as a test instead of discarding it.

> They all happen to pass right now, but just to be safe...

> They all worked when I tried them out, so this is just for future-proofing.

## Assert exact, tight report ranges on the offending span

(13)

Assert start and end of each report, particularly when more than one node is nearby. Review the range itself: it should sit on the right node, without duplicates, and be as small as is useful, such as a keyword rather than a whole call or function.

Why: Without end positions you can't tell the report is on `a` and not `a, b`. Wide ranges produce a lot of squiggly on long constructors and callbacks.

Verify: Include `line`, `column`, `endLine`, and `endColumn` in `errors`, or inspect snapshot underlines character by character. `new Promise(async (resolve, reject) => {` should underline only `async`.

> Could you also add the `endColumn` here too? That way we know it's on the `a`, not `a, b` or some other odd range.

> It looks odd to also squiggly the `|`/`&`. Let's just squiggly the node itself. It's ok for fixers to touch code outside the report range.

## Get tests in place before judging the implementation

(12)

If tests are thin, unreadable, or failing, stop at a high-level pass and ask for cases first. Expect the added cases to force logic changes, so line-level comments before then are likely wasted.

Why: Filling in tests gives a feel for what the code needs to do, and then it's clearer what can be refactored. A rule without tests can't be reviewed in depth.

> I'd suggest you fill in all those tests so we can get a feel for what the code needs to do.

> Which I'm guessing _might_ necessitate changes to the rule's logic.

## Write test cases by hand instead of generating them

(11)

Flag `.map`, `.flatMap`, `.reduce`, spreads of helper output, case factories, and helpers like `batchedSingleLineTests` in rule test files. New cases should be literal objects, even if the surrounding file generates them.

Why: Generated tests are imprecise and hard to statically analyze, produce a huge spread of near-duplicate cases, and obscure what's tested. They also hide line and column assertions from readers.

Verify: Search the test diff for `.map(`, `.flatMap(`, `.reduce(`, and local `create*Case` helpers inside `valid` and `invalid`. typescript-eslint#11323 adds an internal `no-dynamic-tests` rule for this.

> We've been moving away from auto-generated tests. They tend to generate a huge spread of unit tests that each test ever so slightly different variations of the same thing.

> They have a habit of being imprecise and hard to statically analyze.

## Run the rule on the repo and on real code, then reduce what you find

(10)

Enable the rule on the project's own code and read what it reports. Each report is either a real fix to make in the PR or a rule bug that needs a unit test.

Why: Reports on real repo code have exposed bugs the unit tests missed, and running the rule internally can even replace a large unit test. Existing violations get fixed in the same PR.

Verify: Turn the rule on in the repo's lint config, run lint, and triage every report. Add a test for each false positive.

> The only real blocker is that we'll need this running on the repo itself.

> I ran `yarn lint` in the root and looked at the reported violations. It was very informative, would recommend!

## Keep snippets valid and type-clean, using `declare` for typed values

(9)

Test code should compile: declare every referenced variable, avoid syntax or type errors, and stay within what the language allows. Skip cases for code that is already a TypeScript or parse error.

Why: An undeclared identifier is an error type, which is kind of `any` and can hide what's being tested. Type errors in tests will eventually fail, and there's no need to test users calling methods that don't exist.

Verify: Paste each fixture into the TypeScript playground or run type checking on it. Replace bare names like `y` with `declare const y: string;`.

> `y` is an error type (so, kind of `any`) in these tests. Even if that happens to not violate the rule now it's still not a great practice.

> This is a little closer to the intent:

## Require a test with every rule logic change

(7)

A change to a rule's source, including a schema, regex, or default change, should come with a test that fails without it. Each distinct logic change in the diff needs its own coverage.

Why: Bugfixes to lint rules aren't accepted without unit tests, and a test is what shows that the new default or fix really holds.

Verify: Check that the PR touches the rule's test file, then map each changed hunk in the rule to a test.

> We can't take any bugfixes to lint rules that don't have corresponding unit tests.

> There are about a half dozen changes to the rule itself. Each should have a corresponding unit test enforcing it works.

## Strip test code to what the case exercises

(7)

Remove fields and setup from test code that the case doesn't depend on, such as extra `package.json` metadata, and use `declare const value: number` rather than computing a value.

Why: Unnecessary content makes long test lists hard to read through.

> Would you be up for removing the unnecessary-for-tests fields?

> There's no need to store these values in variables - other than to test that storing in a variable isn't broken.

## Add near-miss valid cases one token away from a report

(6)

For each reported shape, add valid cases that differ by one detail: another operator, index, method name, intervening call, or declaration name. Confirm a valid case would actually be reported if the detail changed, or it proves nothing.

Why: These show the rule isn't matching too loosely. A `valid` test that wouldn't violate the rule anyway gives false confidence.

Verify: For `.filter(...)[0]`: `[1]`, `.at(1)`, `.filter(...)` with no index, something between `.filter(...)` and `[0]`, `.find(...)`. For unary minus: `(a: string) => +a;`.

> Putting something between the `.filter(...)` and the `[0]`

> A valid case that would be invalid with a different operator (e.g. `(a: string) => +a;`)

## Target new logic instead of re-testing existing logic

(6)

Trim tests that exercise shared utilities or unrelated behavior the PR didn't change. Each added test should fail without the PR's logic or cover logic specific to this rule.

Why: Tests of already-covered logic are duplicates. They bloat the file and blur what the PR changes. If a gap in other logic is worth covering, it should be a separate test.

Verify: Revert the rule change and rerun tests. Added tests that still pass, and aren't deliberate regression guards, are candidates for removal.

> In other words: each test should be targeted to new logic, not existing logic.

> There's no need for this test. It isn't testing anything new - this file already tests that providing `types` options are respected.

## Use plain template literals for test code

(5; possibly stale: confirm against current code; typescript-eslint)

Write multi-line test code as a single template literal, not concatenated strings or `\n` escapes, and use `noFormat` only for cases that formatting would actually change.

Why: Internal lint rules auto-format test case code, and that only works on the kind of single template literals existing tests use.

Verify: Search test diffs for `\n` inside quoted `code` strings, string concatenation, and `noFormat` on code that is already formatted.

> We have internal lint rules that auto-format test case code, so it's good to use the same kind of single template literals that existing tests generally uses.

> Is there a reason many of these tests use `'` strings with `\n`s, instead of <code>`</code> multiline template literal strings?

## Assert message data in errors

(4; eslint)

When a rule passes `data` to its report or adds logic that chooses message content, every affected `errors` entry should assert `data`, not only `messageId`.

Why: Without `data`, the tests can't catch a bug in the logic that computes the message.

Verify: `errors: [{ data: 'any', messageId: 'anyAssignment' }]`. Break the data-selecting ternary and confirm a test fails.

> Without including `data` in the errors, the tests aren't really testing everything we need them to.

> If there's a bug in the new `isErrorType ? ... : ...` logic, the tests should be able to catch it.

## Turn scenarios named in the issue or PR into tests

(4)

Read the linked issue and PR description, then confirm each snippet, type, or edge case they call out has a test, even if the change doesn't seem to depend on it.

Why: If a case is explicitly discussed, its behavior is intentional and should be pinned down, regardless of what the end behavior turns out to be.

Verify: Copy the issue's reproduction into a test case verbatim, then trim it. Check variants mentioned in passing, such as `(string | number)`.

> Regardless of what the end behavior ends up being, since they're a case explicitly discussed, I think there should be tests for them.

> The reported issue mentions `(string | number)`. Could you add in a cursory bit of testing for that please?

## Move test cases instead of deleting them

(3)

When a change makes a test stop passing, check the deleted cases in the diff. Good cases should move between `invalid` and `valid` unless the behavior was deliberately dropped, and removals in non-breaking PRs need a reason.

Why: Deleted tests lose coverage and can hide a breaking change.

Verify: Compare removed `code:` strings in the test diff with the added ones. Each removed snippet should reappear on the other side or have an explanation.

> These are good cases to test! Even if they switch from `invalid` to `valid`. Let's keep them in the file in some way.

> Could you add these test cases back in, please? This shouldn't be a breaking change PR. They should still be valid code.
