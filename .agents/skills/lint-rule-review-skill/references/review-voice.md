# Review voice

How the skill's output should read, drawn from 799 review bodies and the style and praise comments.
Skip the terse, imperative comments addressed to `@copilot` on Flint: they aren't the tone for human authors.

## Review body

The body is a short summary (median 22 words), and the detail lives in inline comments. It follows this order:

1. One line of specific praise or status, usually with thanks: "A good start", "Progress!", "Very close!"
2. A verdict naming the 1-3 themes of the requested changes, not a list of them: "Requesting changes on X, Y, and Z."
3. What's blocking and what isn't: "The only blocking comment is ...", "Everything else is nitpicking."
4. The scope of this pass. On rough PRs, review at a high level, say so, and promise more once tests or coverage land.
5. What you're unsure of, and whether a second reviewer should look. Extension rules, type system code, scope analysis, and shared formats come up most.
6. A warm close or open question: "WDYT?", "LMK if anything's unclear."

## Inline comments

- **Label them:** use the labels in the table below.
- **Nits:** a short label, one clause of reason, and a ready-to-apply ```` ```suggestion ````.
- **Questions:** often phrased as a question or offer: "Any reason for...?", "Up for...?"
- **Waivers:** say so when a comment isn't blocking: "Not a blocker", "Totally up to you."
- **Direct requests:** save these for real problems, keep them polite, and give the cost: "Could you please revert..."
- **Opinions:** own them as personal: "IMO", "just a personal preference of mine."
- **Repeats:** write "here and elsewhere" instead of commenting on each site.
- **Evidence:** report what was actually tried: "I tried removing this check locally and no unit tests failed."
- **Praise:** short, specific, and it names the thing: "I like how you split this up into functions."

## Labels

| Label | Use |
| --- | --- |
| `[Bug]` | Wrong behavior, ideally with a failing case |
| `[Testing]` | Missing or weak tests |
| `[Docs]` | Docs pages, messages, and comments |
| `[Refactor]` | Structural simplification |
| `[Style]` | Style, usually a nit |
| `[Naming]` | Names, and sometimes typos |
| `[Performance]` | Avoidable work |
| `[Question]` | A real question |
| `[Followup]` | Out of scope for this PR |
| `[Non-Actionable]` | An aside, with no change requested |
| `[Praise]` | Something done well |

Past reviews used these loosely: `[Style]` covers both nits and firm requests, and `[Request]` often marks real bugs.
The skill should use one meaning per label, and state severity separately.

## What earns praise

- Clear, concise rule docs and examples
- Thorough tests where each case tests one thing
- Comments that explain non-obvious reasoning
- Logic split into well-named helpers
- Rule code that is easy to read through
- Changes that remove code and logic
- Tricky syntax handled that the reviewer might have missed
- Reuse of existing utilities and shared logic
