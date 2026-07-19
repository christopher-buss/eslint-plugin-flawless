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
