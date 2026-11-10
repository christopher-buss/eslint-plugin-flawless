# Report messages

Ordered by how often this came up in past reviews. The number is rough weight, not a score.

## Make report messages say why the code is a problem

(23)

Flag messages that only say "avoid", "should not", or "forbidden". The primary message should state the concrete hazard or reason, such as what the code silently does.

Why: Telling developers something is dangerous makes them feel the rule is helping; telling them it's forbidden just makes them resent it. Don't just tell someone to avoid something, explain why.

Verify: Read each message alone and ask whether it answers why the code is bad.

> Telling them something is _"forbidden"_ just makes them resent us.

> I'm trying to overhaul rule messages to always give some sort of _why_ in the `primary` message.

## Keep message IDs static, accurate, and few, using data for variation

(15)

Report with `messageId`, not `message`, except when forwarding text from external tools. Don't build IDs with template strings; inject varying parts through `data`. Describe the construct in words rather than interpolating source text.

Why: Dynamic IDs are hard to statically analyze and eslint-plugin-eslint-plugin's rules choke on them. Users like predictable messages, and long nodes make them funky.

Verify: Search for `messageId:` with a template literal, `message:` in `context.report`, and `{{ }}` placeholders fed by `getText`.

> Dynamically constructed `messageId`s are nifty, but hard to statically analyze.

> For me, dynamic IDs are a hard blocker. All IDs should be statically constructed for readability - both for us humans and the tools around them.

## Reuse the wording of sibling rules and messages

(5)

Compare new message text, `data` values, and punctuation with the closest existing rules or with other messages in the same rule, and match them.

Why: The reviewer repeatedly asks that related rules say the same thing the same way, for consistency across a family of rules.

Verify: Search the rules folder for the same phrase and diff the wording.

> For consistency, let's stick with the same as others.

> To be consistent with the other PR and other rules:

## Read the rendered message as an end user would

(4)

Expand every message with its real `data` values and read the sentence aloud. Look for jargon, awkward grammar from interpolation, and wording that suggests the wrong problem.

Why: End users often don't know internal terms like "Expressions of type", and phrasing can imply the wrong thing is duplicated or missing. A message that needs knowledge of the rule to parse fails its purpose.

Verify: Check the reported message in a test or playground with each interpolation value.

> End users generally don't know well what `Expressions of type` means (even though it is more accurate).

> It took me a few tries to parse out the English grammar in that sentence, and I had to rely on already knowing the rule & this PR.

## Keep full serialized types out of messages

(3)

Flag messages or suggestions that interpolate `typeToString` output for inferred types, and rule-specific truncation logic to tame them. Refer to the type generally, or only use an explicitly written, simple type.

Why: Directly printing types makes messages very long when a type isn't straightforward, and most messages avoid types or refer only to small names.

Verify: Report on a function returning a large inferred object type and check the message length.

> Directly putting `typeToString`-ified types into error messages makes them super long when the type isn't straightforward.

> Most of our error messages either don't mention types or only refer to small names such as identifiers.
