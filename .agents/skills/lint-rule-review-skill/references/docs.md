# Docs pages

Ordered by how often this came up in past reviews. The number is rough weight, not a score.

## Contents

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

## Ship and update docs with every rule, option, and behavior change

(25)

Every new rule needs its docs page and every new option, selector, or setting needs docs and tests. In Flint that means the `.mdx` file plus comparisons data. Usage should be clear from examples.

Why: Docs and option tests are necessities, not extras, and a PR isn't reviewable in depth without them.

Verify: List options in the rule's schema and confirm each has a docs entry and at least one test.

> Just requesting changes to get it documented too. Every selector option should be.

> The explanation is no longer accurate now that they're also considered by the rule.

## Document every option: why it exists, its values, and paired examples

(24)

Every new option or newly supported syntax should have its own section showing how to configure it plus incorrect and correct code tabs for that configuration.

Why: Examples let users see exactly how the code looks. Text and tables alone make it hard to conceptualize what a rule does, and sub-headings without examples don't let readers actually understand the option.

Verify: For each key in the rule's schema, confirm the docs have a matching heading followed by a tabbed or fenced example using that option.

> Could you add some examples please? We generally try to -at least for newly added rule options- so users can see exactly how the code looks.

> The options mentions in this page don't explain why any of the options exist.

## Give When Not To Use It a concrete scenario, and targeted disables first

(20)

Read the When Not To Use It section. It should name a specific situation where the rule is the wrong fit and why, not restate the rule as 'if you don't want X, disable this rule' or a vague 'specific use case'.

Why: A section that only restates the rule's messaging adds no new information. Readers need to know why someone wouldn't want the behavior, for example side-effectful `.filter`s or apps never shipped to production users.

Verify: Delete the rule's name and behavior from each sentence. If nothing remains but 'you can disable this', ask for a named scenario such as an existing codebase style or a legacy runtime.

> Can you elaborate on _why_ someone wouldn't want _X_?

> You might consider using [Flint disable comments](/directives) and/or [configuration file disables](/configuration#files) for those specific situations instead of completely disabling this rule.

## Avoid prescriptive tone, absolutes, and words implying ease

(20)

Flag wording that commands or grants permission: 'is not allowed', 'should not be used', 'should be sorted', 'you may disable', 'this rule prevents'. Prefer 'Prefer X', 'can cause unexpected behavior', 'generally', 'this rule reports on'.

Why: Some folks chafe at stern language, and it can read as 'we're letting you'. Rules only report on violations, and some users mistakenly think rules can't be configured or overridden.

Verify: Try to write one counterexample for each absolute statement, such as a getter with a side effect for 'side-effect-free'.

> _"is not allowed"_ is a bit too prescriptive.

> A lot of new-to-TypeScript folks get confused by the misconception that TypeScript "guarantees" anything. It's good to use words that are a little less absolute.

## State exactly what the rule covers, and keep the page to that rule

(14)

Compare the description, opening text, and When Not To Use It with the implementation. Flag text narrower than the rule (mentions only casing or functions), broader than it, tied to one coincidental case (branded types), or suggesting the opposite of what it does.

Why: Docs that no longer match mislead users. Accidental implications, like a rule being useful only with certain other rules, cause readers to miss its value.

Verify: List every node kind and type the rule matches, then check each appears in the docs and nothing else does.

> It validates more than casing, no? Like, if the file doesn't exist at all, this will catch that, right?

> Nit: not relevant to this rule. We've got a separate one that'll handle that.

## Keep snippets clean, few, and free of distractions

(14)

Example code should compile cleanly apart from the reported problem: no `noImplicitAny` violations, no `any`, no initializer-less `const` (use `declare`), no types that collapse to `never`. Remove things that raise questions, such as unused parameters, variables named after primitives, or unrelated syntax that looks reported.

Why: Readers wonder 'why is this here?'. Distracting details make it unclear which part the rule flags, and unsafe or broken samples set a bad example even when the detail doesn't matter.

Verify: Paste each snippet into the playground with `strict` on. The only diagnostics should come from the rule under discussion.

> Here and in the other code snippet, let's go with no `noImplicitAny` violations:

> There are a _lot_ of lines of examples here.

## Link authoritative external docs under Further Reading

(14)

When a rule targets a language or platform feature with confusing behavior, or an option exists because of a long discussion, check the docs link to MDN, the TS Handbook, the relevant spec page, or the issue comment that explains it. Link the final resource directly, not a comment that points to it.

Why: Sparse explanations aren't useful, and confusing behaviors deserve a link to the main docs. Without the issue context most folks won't know why they'd want an option.

Verify: Check each Further Reading link: no eslint.org, stylelint, or other linter URLs, and the list is sorted by link text.

> JS `delete` behaviors are confusing enough that linking to the main docs would be good IMO.

> No, further reading is for external docs, not linters.

## Define or replace jargon readers won't know

(11)

Find terms a typical user of the rule may not know: type-system concepts (type predicates, phantom types, contextual types, constituents), compiler options, spec terms, and uncommon English. Each should be defined briefly, linked, or replaced with plainer words, in docs and messages.

Why: If a maintainer doesn't know the term, neither will many readers. A quick definition and link to further reading is sufficient, and uncommon words make docs harder to read.

Verify: Ask whether someone who has never touched the type-checking APIs could explain each noun in the first paragraph and the message text.

> I don't know what phantom types are, and neither will many readers of this. This should either define it or be omitted.

> A lot of developers don't know what type predicates are. Could you add a line or two explaining them please?

## Match sibling rules' format and the project's description wording

(11)

Compare headings, tab labels, list styling, and standard sentences with recently updated sibling pages and reuse them, but check any copied text is actually relevant to this rule.

Why: Standardized headings and phrasing keep pages consistent and familiar. Copied boilerplate that doesn't fit is its own problem.

Verify: Diff the page's heading outline against a sibling rule's page.

> Just to align formatting with other rules...

> Keep a normal rule description as before, and only use this _"did you mean?"_-centered wording in rule reports.

## Link TODOs, workarounds, and disables to an issue

(10)

Any `TODO`, known limitation, `eslint-disable`, or workaround for an upstream bug should reference a tracking issue, filed if needed.

Why: It's easy to lose track of these things, and filing gives a link to a full discussion and helps drive to a fix, so the disable is no longer necessary.

Verify: Grep the diff for `TODO`, `eslint-disable`, and `@ts-expect-error`, and confirm each has an issue link.

> Could you file an issue to support spread arguments, and link it in the code comment please? It's easy to lose track of these things

> Approximately every other comment has the same format, no need to diverge here. + having the link to the issue helps cross-link.

## Backtick code terms everywhere

(9)

Identifiers, keywords, option names, and type names like `void` or `Array<string>` should be in backticks in prose, list items, table cells, option headings, and metadata descriptions.

Why: Unformatted terms lose syntax highlighting and can render wrongly, and unbackticked option headings can even fail the website build.

Verify: Build the docs and check option headings. Search prose for bare keywords the rule is about.

> The last item shows up as _"Array - to specify ..."_ in GitHub's rendered pages. Best to backtick.

> The website build is failing because these should be backticked:

## Use the precise term, consistently

(8)

Check that docs, option text, and messages use the correct technical term and the same one throughout: constituents not members, function not `Function`, `string` not `String`, array values not array types.

Why: Technical terms carry specific meanings: 'members' typically refers to class or object members, and `Function` is a specific built-in type devs are trained to avoid. Docs should be consistent with how they phrase it.

> "Members" typically refers to class/object members. The technical term here is _constituents_, I think.

> `Function` is a specific built-in type that TS devs are generally trained to avoid. _"function"_ the term refers to functions.

## Lead with essentials and move niche detail down

(8)

The top of the page should have the pertinent info and plain-text explanation. Details affecting few users, granular options, exhaustive lists, and internal implementation belong in the relevant option section or nowhere.

Why: A lot of seemingly-required reading for a limitation most projects won't hit bogs down the page. Most users don't care how equivalence is determined internally, and a code block above the fold is a tl;dr for many.

> This is a lot of seemingly-required reading for a limitation that most projects won't hit.

> I don't think there's a need to mention granular, specific options in the high-level overview.

## Prefer short sentences, one per line

(8)

Break long multi-clause sentences apart, give separate points their own paragraphs, and cut explanations that run on.

Why: Simplifying makes each sentence readable on its own, which matters for rules using unfamiliar terminology. Short and sweet docs keep people from tiring out of reading them.

Verify: Run the sentences-per-line markdownlint rule, or grep docs for lines containing a period followed by a space and a capital letter.

> Smaller sentences are easier for folks to understand.

> We'll lint for this eventually, but I personally like keeping to one sentence per line

## Explain what the construct is and why it's a problem

(6)

The opening of the page should say in plain text what is being reported and why it causes trouble before showing examples. Check it covers the actual mechanism, not just 'this rule disallows X' or a reference to 'unsafe assumptions'.

Why: A statement that never explains why one form is preferred confuses readers, and someone who doesn't already know the concepts could easily misinterpret it, for instance as saying all type assertions are unsafe.

Verify: Read only the first paragraph and answer: what does the rule flag, and what goes wrong if it's ignored?

> This explanation confused me at first because it never explains _why_ one should be preferred.

> I think we'll want to explicitly call out what the things are in plain text, before getting to the explanation of why we don't want them -> examples of them.

## Don't repeat auto-generated docs content

(6; typescript-eslint)

Remove hand-written text that tooling already renders: option types and defaults, 'Options: None', and sentences repeating the schema description under `insert option description`. If the default can't flow through `defaultOptions`, state it manually.

Why: Our tooling will auto-generate this. Duplicates roughly repeat the option description, and option defaults are automatically stated, so hand-written copies add reading and can drift.

Verify: Build the docs site locally and read the rendered page for sentences that appear twice.

> Our tooling will auto-generate this ✨

> I don't think this is necessary, given that `defaultCaseCommentPattern` already documents itself and automatically mentions its default value.

## Call out surprising limitations and fallbacks

(5)

List what users could reasonably assume but isn't so: unchecked signatures, what counts as a match, implied inclusions, option fallbacks, formats that are allowed. Check each is stated explicitly on the page.

Why: Limitations are surprising if you don't have a good familiarity with the type checking APIs, and unstated behavior leaves long-standing potential confusion.

Verify: Write a test for each stated edge case. Anything that needed a design discussion in the PR should appear in the docs too.

> It's a surprising limitation if you don't have a good familiarity with the type checking APIs.

> I think that should be explicitly called out as allowed in the docs & also tested for.

## Write descriptive link text

(5)

Links should describe their target in the link text itself. Flag '[Docs]', '[documentation]', '[this comment]', and '[here]'.

Why: Informative link titles make it easier to navigate the page with a screenreader. Folks who navigate through page links should be able to glean context from just the link text alone.

Verify: grep for markdown links whose text is only 'docs', 'documentation', 'here', 'this comment', or 'this issue'.

> Informative link titles makes it easier to navigate through the page with a screenreader.

> Accessibility fix: folks who navigate through page links should be able to glean context from just the link text alone.

## Use lists and tables for parallel information

(5)

Where a paragraph enumerates formats, values, or differences between two tools, reformat as a list, comparison table, tabs, or fenced config block.

Why: Points in one paragraph hurt readability, and users want a quick comparison. Long inline config is a lot for a single line.

> I'd expect users will want to be able to see a quick comparison chart. How about reformatting as a table?

> Putting these points all together in a paragraph hurts readability. I'd recommend switching to a list:

## Document only the delta on extension rules

(5; typescript-eslint)

For a rule extending a base rule, keep the page to what it adds: what's newly supported, with examples for that syntax. Don't re-explain base behavior or claim base options as added.

Why: When the base rule's docs are filled out, only a few examples showing the basics and what the new rule adds are needed. Base-rule options technically aren't added.

Verify: Compare the option list and examples to the base rule's docs and remove anything already there.

> This technically isn't _added_, it's already there from the base rule.

> Just a few examples showing the basics of the new rule and what it adds.

## Strip LLM writing habits from rule docs

(4)

In AI-assisted PRs, look for catch-all reasons like 'backwards compatibility', bold labels on list items, sentences praising the language feature, and one-line narration comments.

Why: 'Backwards compatibility' is the catch-all reason LLMs tend to give, and it's debatably incorrect or imprecise. Readers don't need words extolling a feature.

> "backwards compatibility" is the catch-all reason LLMs tend to give for these docs.

> I don't think these list items need to be bold/emphasized; I've been switching the AI-authored docs to not be.

## Keep the old name findable after a rename

(4)

A renamed rule should keep a tombstone page at the old path and a migration notice on the new page naming the old rule. Any deprecation notice should state the rename and removal first, then explain.

Why: Folks might get confused about the rename, and having the old rule named helps people searching for the old name.

Verify: Check the old docs URL still resolves and that the new page contains the old rule's name.

> Having the old rule named here will help with folks searching the old name.

> Could you keep a "tombstone" page for the old rule?

## Omit the bare-string type specifier form

(4; typescript-eslint)

For options that take `TypeOrValueSpecifier`, link the shared format page instead of re-describing it, and don't mention the plain string form.

Why: Catch-all names tend to be overly permissive: the simple string format allows any coincidentally equal name to match, so the team deliberately doesn't encourage it.

Verify: grep the page for 'simple string' or 'independently of its origin'.

> The simple string format is evil 👿. It allows any coincidentally equal name to match.

> catch-all names tend to be overly permissive.

## Label new or experimental rules on the page

(3)

If a rule is experimental or puts forward a new opinion, consider a notice on its docs page saying it may change and asking for feedback, and keep it out of strict presets until proven.

Why: Rules the team hasn't tried before can change significantly. Users should know an opinion is new so they can try it out and report back.

> Maybe we should put some kind of "nursery" notice on this page?

> it's still somewhat experimental / something-we-haven't-tried-ourselves-before.

## Use JSDoc for overviews without restating types

(3)

A comment that summarizes a whole function belongs in a `/** ... */` block on that function, not in `//` lines. JSDoc should not repeat types with tags like `@returns {Boolean}`.

Why: A JSDoc comment works as a good top-level overview, and TypeScript types already describe the types.

Verify: grep -nE '@(param|returns) \{' on the changed files.

> We have TypeScript types, no need to describe them explicitly in comments.

> any reason not to use `/** ... */` here?
