import { unindent } from "eslint-vitest-rule-tester";
import type { InvalidTestCase, ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test.ts";
import { jsxShorthandBoolean, RULE_NAME } from "./rule.ts";

const messageId = "setAttributeValue";
const filename = "file.tsx";

const valid: Array<ValidTestCase> = [
	// Explicit boolean value.
	{ filename, code: "const x = <Component disabled={true} />;" },
	// Explicit falsy value.
	{ filename, code: "const x = <Component disabled={false} />;" },
	// String value.
	{ filename, code: 'const x = <Component name="value" />;' },
	// Expression value.
	{ filename, code: "const x = <Component count={1} />;" },
	// Spread attributes are not shorthand booleans.
	{ filename, code: "const x = <Component {...props} />;" },
	// Namespaced attribute with an explicit value.
	{ filename, code: 'const x = <Component ns:foo="bar" />;' },
];

const invalid: Array<InvalidTestCase> = [
	// A single shorthand boolean attribute.
	{
		filename,
		code: "const x = <Component disabled />;",
		output: "const x = <Component disabled={true} />;",
		errors: [{ messageId }],
	},
	// Multiple shorthand attributes each report and fix.
	{
		filename,
		code: "const x = <Component hidden disabled />;",
		output: "const x = <Component hidden={true} disabled={true} />;",
		errors: [{ messageId }, { messageId }],
	},
	// Mixed shorthand and valued attributes: only the shorthand is fixed.
	{
		filename,
		code: 'const x = <Component name="a" disabled />;',
		output: 'const x = <Component name="a" disabled={true} />;',
		errors: [{ messageId }],
	},
	// A spread attribute alongside a shorthand: the spread is left untouched.
	{
		filename,
		code: "const x = <Component {...props} disabled />;",
		output: "const x = <Component {...props} disabled={true} />;",
		errors: [{ messageId }],
	},
	// No space before the self-closing slash is handled.
	{
		filename,
		code: "const x = <Component disabled/>;",
		output: "const x = <Component disabled={true}/>;",
		errors: [{ messageId }],
	},
	// Namespaced attribute name is preserved.
	{
		filename,
		code: unindent`
			const x = <Component data:active />;
		`,
		output: unindent`
			const x = <Component data:active={true} />;
		`,
		errors: [{ messageId }],
	},
];

run({
	name: RULE_NAME,
	invalid,
	parserOptions: {
		ecmaFeatures: { jsx: true },
		ecmaVersion: "latest",
		sourceType: "module",
	},
	rule: jsxShorthandBoolean,
	valid,
});
