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
		filename: "useForceUpdate.ts",
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
		errors: [{ messageId }],
	},
	// Kebab-case filenames are camelCased, and the export moves below the
	// remaining statements.
	{
		filename: "use-mouse.tsx",
		code: unindent`
			export default () => {}

			export const foo = () => 'foo'
		`,
		output: unindent`
			const useMouse = () => {}

			export const foo = () => 'foo'

			export default useMouse
		`,
		errors: [{ messageId }],
	},
	// The appended export lands after the file's last token, comments included.
	{
		filename: "just_for_fun.js",
		code: unindent`
			export default () => 1

			// line comment
		`,
		output: unindent`
			const justForFun = () => 1

			// line comment

			export default justForFun
		`,
		errors: [{ messageId }],
	},
	// A block-bodied arrow returning JSX is a component, so PascalCase.
	{
		filename: "layout.tsx",
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
		errors: [{ messageId }],
	},
	// A concise arrow returning a fragment is a component too.
	{
		filename: "page.tsx",
		code: "export default () => <></>",
		output: unindent`
			const Page = () => <></>

			export default Page
		`,
		errors: [{ messageId }],
	},
	// Parentheses are not AST nodes, so a parenthesized arrow is reported. The
	// fix replaces only the keywords, so parentheses and comments stay.
	{
		filename: "handler.ts",
		code: "export default (/* keep */ () => 1)",
		output: unindent`
			const handler = (/* keep */ () => 1)

			export default handler
		`,
		errors: [{ messageId }],
	},
	// Type wrappers do not name the arrow; the fix keeps them on the value.
	{
		filename: "handler.ts",
		code: "export default (() => 1) as Handler",
		output: unindent`
			const handler = (() => 1) as Handler

			export default handler
		`,
		errors: [{ column: 17, messageId }],
	},
	{
		filename: "handler.ts",
		code: "export default (() => 1) satisfies Handler",
		output: unindent`
			const handler = (() => 1) satisfies Handler

			export default handler
		`,
		errors: [{ column: 17, messageId }],
	},
	{
		filename: "handler.ts",
		code: "export default (() => 1)!",
		output: unindent`
			const handler = (() => 1)!

			export default handler
		`,
		errors: [{ column: 17, messageId }],
	},
	// Wrappers nest in any order.
	{
		filename: "handler.ts",
		code: "export default ((() => 1) as unknown) as Handler",
		output: unindent`
			const handler = ((() => 1) as unknown) as Handler

			export default handler
		`,
		errors: [{ column: 18, messageId }],
	},
	{
		filename: "handler.ts",
		code: "export default ((() => 1)! satisfies Handler) as Handler",
		output: unindent`
			const handler = ((() => 1)! satisfies Handler) as Handler

			export default handler
		`,
		errors: [{ column: 18, messageId }],
	},
	// An instantiation expression does not name the arrow either.
	{
		filename: "identity.ts",
		code: "export default (<T,>(value: T) => value)<string>",
		output: unindent`
			const identity = (<T,>(value: T) => value)<string>

			export default identity
		`,
		errors: [{ column: 17, messageId }],
	},
	// The trailing semicolon stays, so ASI cannot join the next statement.
	{
		filename: "handler.ts",
		code: unindent`
			export default (() => 1) as Handler;
			(globalThis as any).x = 1;
		`,
		output: unindent`
			const handler = (() => 1) as Handler;
			(globalThis as any).x = 1;

			export default handler
		`,
		errors: [{ messageId }],
	},
	// No fix when the generated name is already bound in the module.
	{
		filename: "page.tsx",
		code: unindent`
			import type { Page } from './types'

			export default (() => <div />) satisfies Page
		`,
		output: null,
		errors: [{ messageId }],
	},
	{
		filename: "handler.ts",
		code: unindent`
			const handler = 1

			export default () => handler
		`,
		output: null,
		errors: [{ messageId }],
	},
	// JSX under a type wrapper in the return value is still a component.
	{
		filename: "page.tsx",
		code: "export default () => <div /> as ReactElement",
		output: unindent`
			const Page = () => <div /> as ReactElement

			export default Page
		`,
		errors: [{ messageId }],
	},
	// Angle-bracket assertions only parse in `.ts` files, not `.tsx`.
	{
		filename: "handler.ts",
		code: "export default <Handler>(() => 1)",
		output: unindent`
			const handler = <Handler>(() => 1)

			export default handler
		`,
		errors: [{ column: 26, messageId }],
	},
	// The name case comes from the unwrapped arrow, so JSX selects PascalCase.
	{
		filename: "page.tsx",
		code: "export default (() => <div />) satisfies Component",
		output: unindent`
			const Page = (() => <div />) satisfies Component

			export default Page
		`,
		errors: [{ messageId }],
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
