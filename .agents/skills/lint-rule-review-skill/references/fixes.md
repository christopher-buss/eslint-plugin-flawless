# Fixers and suggestions

Ordered by how often this came up in past reviews. The number is rough weight, not a score.

## Autofix only what keeps behavior and types; otherwise use a suggestion

(21)

For each `fix`, ask whether it changes runtime behavior or the resulting types. If so it must be a suggestion; if it changes neither, a suggestion should be promoted to a `fix`.

Why: Anything that can break the build goes in suggestions. A change might be objectively better and still not be what a fixer is meant to do. Not changing code or types is roughly the only dividing line.

Verify: Apply the fixer to a typed sample and compare. `arr[arr.length - 1]` -> `arr.at(-1)` turns `T` into `T | undefined`, and `delete arr[i]` -> `arr.splice(i, 1)` changes behavior, so both tests need `output: null` plus `suggestions`.

> We generally put anything that can break the build into _suggestions_ fixers rather than direct _fix_ fixers.

> the fixers would need to be suggestions given they change code behavior

## Keep fixes small and comments intact

(12)

Check that fixers replace the smallest range possible and don't drop or misplace comments inside that range. Fixes that rebuild whole nodes from text are the usual suspects.

Why: Comment handling is what makes autofixes brittle, and the reviewer repeatedly finds comment locations that break them. Existing comment handling must not regress; brand-new gaps can be a followup.

Verify: For each fix, add a test with `/* comment */` at every position inside the replaced range and assert it survives or that no fix is offered.

> I regret not thinking more on comments earlier

> It's hard to write comments handling code that's specific to types of comments & indentation. This very specific, which makes it brittle.

## Prove fix output is valid and keeps operator precedence

(8)

Run each fixer and suggestion against awkward inputs and read the output. It must still compile, keep everything the original declared, and survive precedence and neighboring elements. Compute fix positions from the original node list, not a filtered copy.

Why: A suggestion shouldn't suggest something that's a type error, and shouldn't silently delete what the code meant. Filtering elements before the fixer sees them makes it fix incorrectly around the removed ones.

Verify: Assert exact output for `{ "files": ["README.md", null, "./package.json"] }`: the commas must remain valid with the `null` in the middle (the author confirmed that placement is what fails). For `delete arr[i]` with `i: number | string`, assert no suggestion. For wrapped replacements, reuse the edge cases in `getWrappingFixer` tests.

> The suggestion fixer shouldn't suggest something that's a type error - so I think it shouldn't suggest anything at all in this case.

> Autofixers have a bad habit of changing PEMDAS accidentally.

## Ask whether each report can have a fixer or suggestion

(6)

For each report without `fix` or `suggest`, ask whether a safe fix or suggestion would be straightforward, including on secondary message IDs.

Why: A fix is nice and convenient for users, and for many reports the replacement is straightforward.

Verify: Assert suggestion output in the rule's tests for every report that has a remedy.

> This should have an auto-fixer. Add one.

> The original ESLint rule has an auto-fixer. And what is this "TODO" in suggestions??

## Make fixers edit only the tokens that change

(5)

Flag fixers that call `replaceText` on a whole parent node or rebuild it from strings, and fixers that move comments by hand. Prefer `fixer.remove`, `insertTextBefore`, or `replaceTextRange` on the smallest node or token.

Why: Replacing unchanged text trims comments and mangles formatting, and bigger fix ranges are more likely to overlap when there are multiple reports. If the fixer doesn't remove ranges containing comments, there's no need to manage comment locations.

Verify: Run the fixer on input with comments and unusual spacing between the nodes; both should survive in the output.

> We generally try to avoid replacing text that isn't actually changed.

> Bigger fix ranges are more likely to overlap if there are multiple reports

## Give suggestions their own specific message

(4)

Each suggestion needs a message ID that differs from its report, worded as a specific action. Reports say "Prefer", suggestions say "Use" or "Remove". Placeholders must never render empty, so use a second message ID when data can be missing.

Why: Editors surface suggestions under the error, so repeating the same text is confusing. An empty placeholder produces nonsense such as `Replace with "".`

Verify: Assert `messageId` on each entry in `suggestions` and confirm it differs from the error's. Add a case where optional data is absent and read the rendered text.

> Suggestions should use a different message ID than the parent report. Editors surface them under the messages, so it'd be confusing to have it be the same as the visible error message.

> This `""` means the suggestion message will show up like:

## Compute fix-only values inside the fix

(3)

Variables, node text, and suggestion objects used only by a fixer should be built inside `fix`, or inline in the `context.report` call, rather than ahead of it.

Why: Declaring them outside is confusing, and they don't need to be created until and unless they're needed.

Verify: Check that each variable above `context.report` is used by something other than `fix`.

> Let's move any variables only used for fixing inside the `fix`.

> These objects don't need to be created until & unless they're needed.
