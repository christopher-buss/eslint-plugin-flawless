import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { jsxShorthandBoolean, RULE_NAME } from "./rule";

const messageId = "setAttributeValue";
const filename = "file.tsx";

const valid: Array<ValidTestCase> = [
	// Explicit boolean value.
	{ code: "const x = <Component disabled={true} />;", filename },
	// Explicit falsy value.
	{ code: "const x = <Component disabled={false} />;", filename },
	// String value.
	{ code: 'const x = <Component name="value" />;', filename },
	// Expression value.
	{ code: "const x = <Component count={1} />;", filename },
	// Spread attributes are not shorthand booleans.
	{ code: "const x = <Component {...props} />;", filename },
	// Namespaced attribute with an explicit value.
	{ code: 'const x = <Component ns:foo="bar" />;', filename },
];

const invalid: Array<InvalidTestCase> = [
	// A single shorthand boolean attribute.
	{
		code: "const x = <Component disabled />;",
		errors: [{ messageId }],
		filename,
		output: "const x = <Component disabled={true} />;",
	},
	// Multiple shorthand attributes each report and fix.
	{
		code: "const x = <Component hidden disabled />;",
		errors: [{ messageId }, { messageId }],
		filename,
		output: "const x = <Component hidden={true} disabled={true} />;",
	},
	// Mixed shorthand and valued attributes: only the shorthand is fixed.
	{
		code: 'const x = <Component name="a" disabled />;',
		errors: [{ messageId }],
		filename,
		output: 'const x = <Component name="a" disabled={true} />;',
	},
	// A spread attribute alongside a shorthand: the spread is left untouched.
	{
		code: "const x = <Component {...props} disabled />;",
		errors: [{ messageId }],
		filename,
		output: "const x = <Component {...props} disabled={true} />;",
	},
	// No space before the self-closing slash is handled.
	{
		code: "const x = <Component disabled/>;",
		errors: [{ messageId }],
		filename,
		output: "const x = <Component disabled={true}/>;",
	},
	// Namespaced attribute name is preserved.
	{
		code: unindent`
			const x = <Component data:active />;
		`,
		errors: [{ messageId }],
		filename,
		output: unindent`
			const x = <Component data:active={true} />;
		`,
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
