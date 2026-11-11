import type { InvalidTestCase, ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { jsxShorthandFragment, RULE_NAME } from "./rule";

const useNamedFragment = "useNamedFragment";
const useShorthandFragment = "useShorthandFragment";
const filename = "file.tsx";

const element = { mode: "element" } as const;

const valid: Array<ValidTestCase> = [
	// ── Default "syntax" mode ────────────────────────────────
	// The shorthand is already used.
	{ filename, code: "const x = <>{value}</>;" },
	// A regular element is untouched.
	{ filename, code: "const x = <div>{value}</div>;" },
	// A named fragment carrying a `key` cannot use the shorthand.
	{ filename, code: 'const x = <Fragment key="a">{value}</Fragment>;' },
	// A member-expression fragment with an attribute is left alone.
	{
		filename,
		code: 'const x = <React.Fragment key="a">{value}</React.Fragment>;',
	},

	// ── "element" mode ───────────────────────────────────────
	// A named fragment is already used.
	{ filename, code: "const x = <Fragment>{value}</Fragment>;", options: [element] },
	// A regular element is untouched.
	{ filename, code: "const x = <div>{value}</div>;", options: [element] },
	// A member-expression fragment is a named form, not the shorthand.
	{
		filename,
		code: "const x = <React.Fragment>{value}</React.Fragment>;",
		options: [element],
	},
	// A custom named fragment matching the configured option.
	{
		filename,
		code: "const x = <Frag>{value}</Frag>;",
		options: [{ fragmentName: "Frag", mode: "element" }],
	},
];

const invalid: Array<InvalidTestCase> = [
	// ── Default "syntax" mode ────────────────────────────────
	// A named fragment is rewritten to the shorthand.
	{
		filename,
		code: "const x = <Fragment>{value}</Fragment>;",
		output: "const x = <>{value}</>;",
		errors: [{ messageId: useShorthandFragment }],
	},
	// A member-expression fragment is rewritten to the shorthand.
	{
		filename,
		code: "const x = <React.Fragment>{value}</React.Fragment>;",
		output: "const x = <>{value}</>;",
		errors: [{ messageId: useShorthandFragment }],
	},
	// Children are preserved.
	{
		filename,
		code: "const x = <Fragment><span>a</span>{value}</Fragment>;",
		output: "const x = <><span>a</span>{value}</>;",
		errors: [{ messageId: useShorthandFragment }],
	},
	// A childless self-closing fragment collapses to `<></>`.
	{
		filename,
		code: "const x = <Fragment />;",
		output: "const x = <></>;",
		errors: [{ messageId: useShorthandFragment }],
	},
	// A configured `fragmentName` is also recognized as a named fragment.
	{
		filename,
		code: "const x = <Frag>{value}</Frag>;",
		output: "const x = <>{value}</>;",
		options: [{ fragmentName: "Frag" }],
		errors: [{ messageId: useShorthandFragment }],
	},

	// ── "element" mode ───────────────────────────────────────
	// The shorthand is rewritten to the default `Fragment` name.
	{
		filename,
		code: "const x = <>{value}</>;",
		output: "const x = <Fragment>{value}</Fragment>;",
		options: [element],
		errors: [{ messageId: useNamedFragment }],
	},
	// The configured fragment name is used.
	{
		filename,
		code: "const x = <>{value}</>;",
		output: "const x = <Frag>{value}</Frag>;",
		options: [{ fragmentName: "Frag", mode: "element" }],
		errors: [{ messageId: useNamedFragment }],
	},
	// Children (text and elements) are preserved.
	{
		filename,
		code: "const x = <><span>a</span>{value}</>;",
		output: "const x = <Fragment><span>a</span>{value}</Fragment>;",
		options: [element],
		errors: [{ messageId: useNamedFragment }],
	},
	// Nested shorthand fragments each report; the outer fix runs first.
	{
		filename,
		code: "const x = <><>{value}</></>;",
		output: "const x = <Fragment><Fragment>{value}</Fragment></Fragment>;",
		options: [element],
		errors: [{ messageId: useNamedFragment }, { messageId: useNamedFragment }],
	},
	// An empty shorthand fragment is rewritten.
	{
		filename,
		code: "const x = <></>;",
		output: "const x = <Fragment></Fragment>;",
		options: [element],
		errors: [{ messageId: useNamedFragment }],
	},
	// A member-expression name option produces a valid named fragment.
	{
		filename,
		code: "const x = <>{value}</>;",
		output: "const x = <React.Fragment>{value}</React.Fragment>;",
		options: [{ fragmentName: "React.Fragment", mode: "element" }],
		errors: [{ messageId: useNamedFragment }],
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
