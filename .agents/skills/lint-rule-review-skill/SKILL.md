---
name: lint-rule-review-skill
description: Review a custom lint rule the way an experienced ESLint, typescript-eslint, and Flint maintainer would, proving bugs by mutating the rule and running adversarial test cases. Use this whenever the user asks to review, audit, critique, or sanity-check a lint rule, a rule's fixer, its tests, or its docs, or a PR or branch that adds or changes one, even if they only say "take a look at this rule" or give a PR number in a linter or plugin repo. Don't use it for configuring lint rules in a project or fixing lint errors in application code.
---

# ESLint Rule Review Skill

Review a lint rule the way a maintainer with thousands of past review comments would.
That maintainer's defining habit is empirical: they don't just read a rule, they try to break it.
They delete a condition and see whether a test fails, and they invent the syntax nobody thought of.
Follow that habit here.
A finding backed by a failing test or a surviving mutant is worth far more than a plausible-sounding one, and plausible-sounding noise is what makes automated reviews get ignored.

The findings go to the user, who decides what to do with them.
Writing the review to a local file is the whole job: posting to GitHub, or pushing anything, happens only if the user separately asks for it.

## 1. Understand the change

Work out what is under review: a PR, a branch, or a rule file.
For a PR, check out its head commit if you can, because later steps run the code.

Read these before forming opinions:

- The rule, its tests, and its docs page
- The PR description and linked issue, because a rule is judged against its purpose, not its own algorithm
- Two or three sibling rules in the same repo, plus `CONTRIBUTING` docs

Note any question the author asks in the description.
The review should answer it.

Repo conventions beat this skill's references.
The references come from several projects, so if a pattern contradicts what the repo clearly does, follow the repo.

The references are large, so don't read them end to end.
Start from [references/index.md](references/index.md), which lists every pattern, and pull only the sections that fit this change.
Also read [references/extra-checks.md](references/extra-checks.md), which is short and covers tool pitfalls plus checks for fixers, import rules, and Flint.

## 2. Check the rule's design

Pick from the `design.md` list in the index by the kind of change:

- **New rule:** whether it belongs, its scope, overlap with other rules, type information, options, and preset placement.
- **Change to an established rule:** semver impact, sibling rules that need the same change, and whether the change serves the issue.
  Skip the rest.

If the PR is rough, such as having no tests yet or a design that needs rethinking, stop at a high-level review and say so, and skip mutation, which can't tell you anything without tests.
Still try the rule on a few cases, since a real bug is worth reporting at any stage.
Detailed comments on code that's about to change waste everyone's time.

## 3. Read every added line

Use the index to pull the sections that match what changed:

| Changed                      | Look in                                          |
| ---------------------------- | ------------------------------------------------ |
| Rule logic                   | `bugs.md`, `simplification.md`, `performance.md` |
| Fixers or suggestions        | `fixes.md`                                       |
| Messages                     | `messages.md`                                    |
| Tests                        | `test-method.md`                                 |
| Docs pages                   | `docs.md`                                        |
| New names, options, or rules | `naming.md`                                      |

Do this before trying to break anything, because bug hunting takes over once it starts.
Take notes as you go, and sort them in step 5.

**Go through the diff one added line at a time**, and ask these of each:

- **Names:** could you tell what this identifier holds or does without reading further?
  Watch for names that describe a type rather than a purpose, and names that claim the wrong action.
  If it took a second read to understand, say so and suggest a better name.
- **Locals:** is this variable used once, right after it's set?
  Suggest inlining it.
- **Conditions:** does it collapse? `!x || x.kind !== y` becomes `x?.kind !== y`.
  Nested or adjacent `if`s often merge, and a boolean `if` often returns directly.
- **Guards:** can this state really happen, given the AST and the code above it?
- **Reuse:** does a shared utility do this already?
  Check before accepting any helper.
  Would a helper need fewer parameters if it lived inside `create`?
- **Length:** is there less code that does the same thing?
  Simplification is the largest category in past reviews.
- **Worth doing:** does this code or `TODO` plan for something nobody needs?
  Say it can go.

If the code looks AI-assisted, read it with a more discerning eye, because that's where padding tends to collect.

**Sweep every comment and docs sentence.** Bug hunting crowds this out, yet it's a regular source of real review comments, so do it as a separate pass over each added comment and each added line of docs.
Don't ask whether it's correct, ask whether it should be there as written:

- Will this comment go stale?
  Notes about test coverage, history, or what a test covers do, so suggest deleting them.
- Does it restate the code?
  Suggest deleting it.
- Is it a significant known shortcut, such as a fork of upstream code?
  Ask for a `TODO`, with an issue link if one exists, and suggest the exact comment.
- Would an end user care about this docs sentence?
  Implementation details don't belong on the page.
- Does this docs example carry code it doesn't need?
  Suggest trimming anything beyond what shows the behavior.
- Is the sentence precise?
  Watch for wording that sounds universal or always true when it isn't, and suggest a rewrite.

Give these as ` ```suggestion ` blocks.
They're quick for the author to accept.

**Notice what's good.** Note anything that helped you review or handles something tricky, and mention it specifically, in the review body or as a `[Praise]` comment.

## 4. Try to break it

This step produces the highest-value findings, so don't skip it.
Start by getting the rule's existing tests to pass, so you have a working command that runs just this rule's tests.

**Mutate the conditions.** Run the bundled script from the repo root.
It needs Node 22.18 or newer, which may differ from the version the repo pins.
Each mutant is one test run, so run it in the background.
It edits the rule in place, so anything else you run in the meantime has to use a copy of the rule saved under a temporary name:

```bash
node <skill-dir>/scripts/mutate-conditions.ts --file <rule> --test "<test command>" --base <base ref>
```

`--base` limits mutants to lines the PR changed, and `--diff <file>` does the same from a diff.
Omit both to mutate a whole new rule.
Mutants run in source order up to `--max`, 60 by default, so raise it if the summary shows any not tested.
If the tests run from a package folder, run the script from there. `--out <file>` saves the full results, and a short list of survivors always prints last.
It first checks that the tests fail when the rule throws, and stops if they don't, because then they aren't exercising the rule.
The script restores the file when it finishes or is stopped.
If it's killed outright, the next run refuses to start and prints where the original is saved, so compare the two before changing the rule, because you may have edited it since.
If the test command builds the rule, rebuild afterward, because the build output still has the last mutant.
It parses with the repo's `typescript`, and on TypeScript 7 or later it prints how to pass an older copy with `--typescript`.

Mutants the tests don't notice are survivors: each one means a test is missing or the code is dead, and you should work out which.
Delete the condition and think about what input would need it.
If you can't construct one, recommend deleting the code.
If you can, add it to the next step.
Survivors marked `likelyTypeOnly` are bare null-check exits that often exist only for the compiler, so look at them last, but check that the branch isn't simply untested.
If the test runner type-checks, a mutant can also "fail" just because it doesn't compile, so use a transpile-only command where you can.

The script only covers common mutations.
Also try by hand anything it can't reach that the PR depends on, such as swapping an argument for a similar variable already in scope.

**Compare head and base.** For a change to an existing rule, this is the most important check.
A regression in code that used to work matters far more than a gap that was already there, and you can't tell them apart without running both versions.
Save the base version beside the rule, for example with `git show <base>:./<rule> > <rule-dir>/<name>.base-tmp.ts`, or by reverse-applying the diff.
Then copy [assets/compare-rule.test.ts](assets/compare-rule.test.ts) beside the rule's tests and adjust its marked lines.
It sorts each case by comparing report counts, and it also records messages, ranges, fix output, suggestions, crashes, and compile errors in each fixture.
Read `CHANGED OUTPUT` results yourself, because a changed message or fix may be the bug, and ignore any case with `fixtureErrors` until its fixture compiles.
For a PR that adds a fixer, the fix and suggestion output is the main thing to read, so set `expectedOutput` on those cases.
If the PR adds an option, set `baseOptions` so that the base version's schema accepts the case.
Without it, the case is judged on head alone.

For a new rule, import it as both `head` and `base`, so that the harness reports `ok` or `WRONG` instead of comparing versions.
If the harness doesn't fit the plugin, use a temporary test file in the repo's own test harness instead.

**Write adversarial cases.** Pick the categories from [references/test-cases.md](references/test-cases.md) that fit the syntax and types this rule touches, and write literal cases.
Decide the correct behavior before running each case, because it stops you rationalizing whatever comes back.
Print message data as well as report counts, since a wrong type name in a message is a bug too.
Pair a case in new syntax with a control in old syntax, such as a symbol key with the same case using a string key.
Look for:

- Crashes
- False positives, where valid code is reported
- False negatives, where invalid code isn't reported
- Fixes that produce invalid code, change behavior, or drop comments
- Report ranges that are wider than the offending code

Keep the cases that exposed something so that they can go in the review as literal test cases.
Literal matters: this maintainer asks for hand-written cases and pushes back on `.map`, factories, and generated tests.

**Prove big suggestions.** If you think a redesign would remove several bugs, prototype it and run the existing tests. "267 of 268 tests pass, and here's why the other fails" is far more useful than a hunch.

**Clean up.** Run `git status` and remove every temporary file before moving on, so the repo is back to how you found it.

## 5. Filter the findings

Before writing anything, go through each finding:

- **Bugs:** include the case and what actually happened.
  If you couldn't reproduce it, cut it, or downgrade it to a `[Question]` if you still have a specific reason to suspect it.
- **Order:** regressions come first, then bugs in new code, then existing bugs the PR touches.
- **One root cause:** if a redesign would fix several bugs, make that one comment and list the cases in it.
  Keep a separate comment only where a bug needs its own fix either way, such as a regression.
- **Contested positions:** treat these as non-blocking questions: `in` checks on nodes, `esquery` use, option schema shape, and `import ts` style.
  Other maintainers have reasonably disagreed on them.
- **Widen or defer:** if a gap is the same concept as the rule and real users would hit it, ask for it in this PR.
  Otherwise suggest a followup issue.
- **Add or drop an option:** ask for an option only where the rule would otherwise ban valid code, or where a real user asked for one.
- **Existing code:** leave out problems the PR didn't touch unless they're serious, and mark those `[Non-Actionable]`.
- **Duplicates:** merge repeats into one comment that says "here and elsewhere".

Noise costs more than a miss: an author who skims past three weak comments will skim past the real one too.
Blocking comments should be only what must change before merge.
Keep at most about eight non-blocking comments, choosing the ones that most improve the code, with a ready-to-apply suggestion wherever the comment requests a change.
Cut these first:

- Matters of taste with no real gain in clarity, such as rewording a message or collapsing a conditional that reads fine
- Anything the description says is deliberate, such as scaffolding for planned work
- Bugs you tried and couldn't find a real case for, with no specific reason left to suspect them
- Whitespace and quote style
- Requests for process that adds nothing, such as a tracking issue for every small `TODO`

Nothing to report is a fine result, so don't invent findings to look thorough.

Match the verdict to the blocking comments.
If nothing blocks, approve and leave the rest as suggestions.
Many reviews from this maintainer on solid PRs are a warm approval with one or two small requests.

## 6. Write the review

Read [references/review-voice.md](references/review-voice.md), then write `lint-rule-review-skill-<pr-or-rule>.md` in the current directory, without committing it.
Keep the review body to a few sentences, going longer only to answer the author's questions or explain a design call.
Use this structure:

````markdown
# Review of <PR or rule>

**Verdict:** approve | request changes | high-level only

<Review body, following the order in review-voice.md>

## Inline comments

### `path/to/file.ts:42` · blocking

[Bug] <Comment as it would be posted>

```ts
<Literal failing case or suggestion>
```

Evidence: <What you ran and what happened, or "not reproduced">

## Not checked

<Anything you couldn't run or verify, and why>
````

Mark each comment `blocking` or `non-blocking`, ordered blocking first. "Evidence" is for the user and wouldn't be posted, so be plain there about how strong each finding is.
Finish by giving the user the verdict, the blocking findings, and the file path.
