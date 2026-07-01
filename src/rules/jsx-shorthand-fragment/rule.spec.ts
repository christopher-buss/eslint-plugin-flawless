import type { InvalidTestCase, ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { jsxShorthandFragment, RULE_NAME } from "./rule";

const messageId = "useNamedFragment";
const filename = "file.tsx";

const valid: Array<ValidTestCase> = [
	// A named fragment is already used.
	{ code: "const x = <Fragment>{value}</Fragment>;", filename },
	// A custom named fragment matching the configured option.
	{ code: "const x = <Frag>{value}</Frag>;", filename, options: ["Frag"] },
	// A regular element is untouched.
	{ code: "const x = <div>{value}</div>;", filename },
	// A named member-expression fragment element is not a shorthand fragment.
	{ code: "const x = <React.Fragment>{value}</React.Fragment>;", filename },
];

const invalid: Array<InvalidTestCase> = [
	// Shorthand fragment is rewritten to the default `Fragment` name.
	{
		code: "const x = <>{value}</>;",
		errors: [{ messageId }],
		filename,
		output: "const x = <Fragment>{value}</Fragment>;",
	},
	// The configured fragment name is used.
	{
		code: "const x = <>{value}</>;",
		errors: [{ messageId }],
		filename,
		options: ["Frag"],
		output: "const x = <Frag>{value}</Frag>;",
	},
	// Children (text and elements) are preserved.
	{
		code: "const x = <><span>a</span>{value}</>;",
		errors: [{ messageId }],
		filename,
		output: "const x = <Fragment><span>a</span>{value}</Fragment>;",
	},
	// Nested shorthand fragments each report; the outer fix runs first.
	{
		code: "const x = <><>{value}</></>;",
		errors: [{ messageId }, { messageId }],
		filename,
		output: "const x = <Fragment><Fragment>{value}</Fragment></Fragment>;",
	},
	// An empty shorthand fragment is rewritten.
	{
		code: "const x = <></>;",
		errors: [{ messageId }],
		filename,
		output: "const x = <Fragment></Fragment>;",
	},
	// A member-expression name option produces a valid named fragment.
	{
		code: "const x = <>{value}</>;",
		errors: [{ messageId }],
		filename,
		options: ["React.Fragment"],
		output: "const x = <React.Fragment>{value}</React.Fragment>;",
	},
];

run({
	name: RULE_NAME,
	// This rule is not type-aware, so opt out of the shared type-aware project
	// (which would reject virtual `.tsx` files) and enable JSX parsing directly.
	invalid,
	parserOptions: {
		ecmaFeatures: { jsx: true },
		ecmaVersion: "latest",
		sourceType: "module",
	},
	rule: jsxShorthandFragment,
	valid,
});
