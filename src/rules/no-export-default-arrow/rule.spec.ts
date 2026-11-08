import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { noExportDefaultArrow, RULE_NAME } from "./rule";

const messageId = "disallowExportDefaultArrow";

const valid: Array<ValidTestCase> = [
	// A named constant exported separately is the form this rule enforces.
	unindent`
		const foo = () => {
			return 'foo'
		}

		export default foo
	`,
	// Arrows that are not default exports are untouched.
	"const now = () => Date.now()",
	"export const useQuery = () => {}",
	// A wrapped arrow in a named constant is already named.
	unindent`
		const handler = (() => 1) as Handler
		export default handler
	`,
	// Only arrows are reported; a wrapped function expression has its own name.
	"export default (function handler() {}) as Handler",
	// Arrows nested inside the exported value are not the value itself.
	"export default [() => 1] as const",
	"export default { run: () => 1 } satisfies Task",
	"export default call(() => 1)",
];

const invalid: Array<InvalidTestCase> = [
	// The name comes from the filename, camelCased for non-JSX arrows.
	{
		code: unindent`
			import { useState } from 'react'

			export default () => {
				const [, update] = useState({})

				const forceUpdate = () => {
					update({})
				}

				return forceUpdate
			}
		`,
		errors: [{ messageId }],
		filename: "useForceUpdate.ts",
		output: unindent`
			import { useState } from 'react'

			const useForceUpdate = () => {
				const [, update] = useState({})

				const forceUpdate = () => {
					update({})
				}

				return forceUpdate
			}

			export default useForceUpdate
		`,
	},
	// Kebab-case filenames are camelCased, and the export moves below the
	// remaining statements.
	{
		code: unindent`
			export default () => {}

			export const foo = () => 'foo'
		`,
		errors: [{ messageId }],
		filename: "use-mouse.tsx",
		output: unindent`
			const useMouse = () => {}

			export const foo = () => 'foo'

			export default useMouse
		`,
	},
	// The appended export lands after the file's last token, comments included.
	{
		code: unindent`
			export default () => 1

			// line comment
		`,
		errors: [{ messageId }],
		filename: "just_for_fun.js",
		output: unindent`
			const justForFun = () => 1

			// line comment

			export default justForFun
		`,
	},
	// A block-bodied arrow returning JSX is a component, so PascalCase.
	{
		code: unindent`
			export default () => {
				return (
					<html>
						<head />
						<body></body>
					</html>
				)
			}
		`,
		errors: [{ messageId }],
		filename: "layout.tsx",
		output: unindent`
			const Layout = () => {
				return (
					<html>
						<head />
						<body></body>
					</html>
				)
			}

			export default Layout
		`,
	},
	// A concise arrow returning a fragment is a component too.
	{
		code: "export default () => <></>",
		errors: [{ messageId }],
		filename: "page.tsx",
		output: unindent`
			const Page = () => <></>

			export default Page
		`,
	},
	// Parentheses are not AST nodes, so a parenthesized arrow is reported. The
	// fix replaces only the keywords, so parentheses and comments stay.
	{
		code: "export default (/* keep */ () => 1)",
		errors: [{ messageId }],
		filename: "handler.ts",
		output: unindent`
			const handler = (/* keep */ () => 1)

			export default handler
		`,
	},
	// Type wrappers do not name the arrow; the fix keeps them on the value.
	{
		code: "export default (() => 1) as Handler",
		errors: [{ column: 17, messageId }],
		filename: "handler.ts",
		output: unindent`
			const handler = (() => 1) as Handler

			export default handler
		`,
	},
	{
		code: "export default (() => 1) satisfies Handler",
		errors: [{ column: 17, messageId }],
		filename: "handler.ts",
		output: unindent`
			const handler = (() => 1) satisfies Handler

			export default handler
		`,
	},
	{
		code: "export default (() => 1)!",
		errors: [{ column: 17, messageId }],
		filename: "handler.ts",
		output: unindent`
			const handler = (() => 1)!

			export default handler
		`,
	},
	// Wrappers nest in any order.
	{
		code: "export default ((() => 1) as unknown) as Handler",
		errors: [{ column: 18, messageId }],
		filename: "handler.ts",
		output: unindent`
			const handler = ((() => 1) as unknown) as Handler

			export default handler
		`,
	},
	{
		code: "export default ((() => 1)! satisfies Handler) as Handler",
		errors: [{ column: 18, messageId }],
		filename: "handler.ts",
		output: unindent`
			const handler = ((() => 1)! satisfies Handler) as Handler

			export default handler
		`,
	},
	// An instantiation expression does not name the arrow either.
	{
		code: "export default (<T,>(value: T) => value)<string>",
		errors: [{ column: 17, messageId }],
		filename: "identity.ts",
		output: unindent`
			const identity = (<T,>(value: T) => value)<string>

			export default identity
		`,
	},
	// The trailing semicolon stays, so ASI cannot join the next statement.
	{
		code: unindent`
			export default (() => 1) as Handler;
			(globalThis as any).x = 1;
		`,
		errors: [{ messageId }],
		filename: "handler.ts",
		output: unindent`
			const handler = (() => 1) as Handler;
			(globalThis as any).x = 1;

			export default handler
		`,
	},
	// No fix when the generated name is already bound in the module.
	{
		code: unindent`
			import type { Page } from './types'

			export default (() => <div />) satisfies Page
		`,
		errors: [{ messageId }],
		filename: "page.tsx",
		output: null,
	},
	{
		code: unindent`
			const handler = 1

			export default () => handler
		`,
		errors: [{ messageId }],
		filename: "handler.ts",
		output: null,
	},
	// JSX under a type wrapper in the return value is still a component.
	{
		code: "export default () => <div /> as ReactElement",
		errors: [{ messageId }],
		filename: "page.tsx",
		output: unindent`
			const Page = () => <div /> as ReactElement

			export default Page
		`,
	},
	// Angle-bracket assertions only parse in `.ts` files, not `.tsx`.
	{
		code: "export default <Handler>(() => 1)",
		errors: [{ column: 26, messageId }],
		filename: "handler.ts",
		output: unindent`
			const handler = <Handler>(() => 1)

			export default handler
		`,
	},
	// The name case comes from the unwrapped arrow, so JSX selects PascalCase.
	{
		code: "export default (() => <div />) satisfies Component",
		errors: [{ messageId }],
		filename: "page.tsx",
		output: unindent`
			const Page = (() => <div />) satisfies Component

			export default Page
		`,
	},
];

run({
	name: RULE_NAME,
	invalid,
	// The shared defaults omit JSX and pin a `project` whose only files are
	// `fixtures/file.ts` and `fixtures/file.tsx`; this rule derives names from
	// arbitrary filenames, so it needs a project-free, JSX-enabled parser.
	parserOptions: {
		ecmaFeatures: { jsx: true },
		ecmaVersion: "latest",
		sourceType: "module",
	},
	rule: noExportDefaultArrow,
	valid,
});
