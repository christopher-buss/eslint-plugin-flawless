# Naming and consistency

Ordered by how often this came up in past reviews. The number is rough weight, not a score.

## Treat option names as public API: precise, consistent, lenient when enabled

(19)

Review each option name for brevity and accuracy, and rule names against the family's prefix convention. Allow time for maintainers to suggest alternatives before merge.

Why: Naming alone is enough to request changes even when the logic is done, and PRs are held open so other maintainers can weigh in on an API name.

Verify: Compare the new option against the rule's other options and neighboring rules' schemas for plurality and casing.

> Just requesting changes on the name, since `onlyTrue` is a lot cleaner IMO.

> This is a little imprecise - the option is directed towards superfluous/unnecessary defaults on already-exhaustive switches

## Name functions and helpers for exactly what they do

(15)

Compare each helper's name with its body. Flag vague `isExpected*` names, `try*` names on functions that never throw, `find*` names that hide the direction of the search, names claiming a property the code cannot know (`isPure`), and names that omit a side effect such as reporting.

Why: Mismatched names confused the reviewer on first read and cost a re-read. Names should say explicitly what the code does without needing the full intent first.

> my instinct for things named _"try*"_ is that they literally use a `try`/`catch` and/or may throw an error. This doesn't.

> Nit: a more precise name...

## Match the names and constructs already in the file or project

(12)

Compare new code with neighboring rules: import aliases (`tsutils`, not `tsUtils` or `tsApiUtils`), loop style in the same file, comment capitalization, and whether any other rule does the same thing.

Why: Switching styles in a file makes it hard to mentally map between the two. "No other rule does this" is itself a reason to change.

Verify: Search the repo for the construct, for example grep -rn "from 'ts-api-utils'" on the rules folder, and compare with the new code.

> If not, please stick with the existing style in a file/project. It's hard to mentally map between two.

> We generally try to stay away from acronyms when possible.

## Replace placeholder and abbreviated names

(10)

Flag names that carry no meaning in already-complex logic: `iterator`, `key`/`value`, `result`, numbered suffixes like `comments1`/`comments2`, generic `node`, or `fn`/`rec`. A reader should not have to scan other code to learn what the value is.

Why: Rule logic is already complex, so vague names force the reader to scan back and forth or deduce a role from scratch each time.

Verify: Search the changed rule for short identifiers: grep -nE '\b(fn|decl|num|uniq|prev|ctor)[A-Z]?' on the rule file.

> This code is already kind of complex, let's stick with informative names.

> I'm not a fan of abbreviating names in code. It makes it harder to read & understand because you have to memorize all sorts of common abbreviations

## Drop words already implied by context

(7)

Remove name segments the surrounding context already states: `Sorting` in an option of a sort rule, a `Map` suffix on a map, `check*` before `should*`, `utils` in a file inside a utils folder, or a property repeating its parent's name.

Why: Implied words add length without information, and repeated terms like two nested things both called the same are confusing to new readers.

> I think _"Sorting"_ is implied by the rule. IMO it'd be a little cleaner to drop it:

> this is already in a utils folder. Every file here is some kind of utils.

## Insert into sorted lists in sorted order

(5)

When a change adds to a union, map, rule list, `messages` object, or docs list, check whether the entries were alphabetical and keep them so.

Why: Alphabetical lists are easier to scan through. The reviewer notices breakage and explicitly praises authors who preserve the order.

Verify: Diff the list against a sorted copy of itself.

> Super nitpicky, but - these _were_ in alphabetical order. Up for alphabetizing?

> The list is in alphabetical order to make it easier to scan through. Let's move this to the top.

## Proofread identifiers for typos and bad word splits

(4)

Read new function and variable names letter by letter for misspellings, wrong casing inside a word, and extra letters.

Why: These slip through in new helpers and the reviewer fixes them with a one-line suggestion, often labeled simply as a typo.

Verify: Run a spell checker over the changed identifiers, for example cspell on the rule file.

> Typo:

> Typo: no 'e' 🙂

## Use the canonical `ts` namespace for TypeScript imports

(4)

Prefer `import * as ts from "typescript"` and `ts.SyntaxKind` over named imports, local aliases, or a second import form in the same file.

Why: The `ts` namespace is the standard across TS static analysis projects and docs, and the `typescript` package isn't tree-shakeable, so granular imports don't help. A contributor disagreed, so this remains a stated preference.

Verify: Search for `} from "typescript"` and `const SyntaxKind = ts.SyntaxKind`.

> In every other TS static analysis project I've worked on, including typescript-eslint, we do the `ts` namespace.

> It's the canonical/standard way to import from TS

## Name rules for precisely what they check

(3)

Ask whether a rule's name conveys what it checks and could not be mistaken for something else, while staying reasonably short.

Why: A name can be accurate but not precise. Misconceptions are easy, for example `no-partial-destructuring` sounds like it is about runtime rather than types.

> It's accurate, but not precise...

> `no-partial-destructuring` makes it sound not specific to types. I think we'll want to avoid misconceptions like that.
