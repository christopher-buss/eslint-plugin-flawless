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
	{ code: "const x = <>{value}</>;", filename },
	// A regular element is untouched.
	{ code: "const x = <div>{value}</div>;", filename },
	// A named fragment carrying a `key` cannot use the shorthand.
	{ code: 'const x = <Fragment key="a">{value}</Fragment>;', filename },
	// A member-expression fragment with an attribute is left alone.
	{
		code: 'const x = <React.Fragment key="a">{value}</React.Fragment>;',
		filename,
	},

	// ── "element" mode ───────────────────────────────────────
	// A named fragment is already used.
	{ code: "const x = <Fragment>{value}</Fragment>;", filename, options: [element] },
	// A regular element is untouched.
	{ code: "const x = <div>{value}</div>;", filename, options: [element] },
	// A member-expression fragment is a named form, not the shorthand.
	{
		code: "const x = <React.Fragment>{value}</React.Fragment>;",
		filename,
		options: [element],
	},
	// A custom named fragment matching the configured option.
	{
		code: "const x = <Frag>{value}</Frag>;",
		filename,
		options: [{ fragmentName: "Frag", mode: "element" }],
	},
];

const invalid: Array<InvalidTestCase> = [
	// ── Default "syntax" mode ────────────────────────────────
	// A named fragment is rewritten to the shorthand.
	{
		code: "const x = <Fragment>{value}</Fragment>;",
		errors: [{ messageId: useShorthandFragment }],
		filename,
		output: "const x = <>{value}</>;",
	},
	// A member-expression fragment is rewritten to the shorthand.
	{
		code: "const x = <React.Fragment>{value}</React.Fragment>;",
		errors: [{ messageId: useShorthandFragment }],
		filename,
		output: "const x = <>{value}</>;",
	},
	// Children are preserved.
	{
		code: "const x = <Fragment><span>a</span>{value}</Fragment>;",
		errors: [{ messageId: useShorthandFragment }],
		filename,
		output: "const x = <><span>a</span>{value}</>;",
	},
	// A childless self-closing fragment collapses to `<></>`.
	{
		code: "const x = <Fragment />;",
		errors: [{ messageId: useShorthandFragment }],
		filename,
		output: "const x = <></>;",
	},
	// A configured `fragmentName` is also recognized as a named fragment.
	{
		code: "const x = <Frag>{value}</Frag>;",
		errors: [{ messageId: useShorthandFragment }],
		filename,
		options: [{ fragmentName: "Frag" }],
		output: "const x = <>{value}</>;",
	},

	// ── "element" mode ───────────────────────────────────────
	// The shorthand is rewritten to the default `Fragment` name.
	{
		code: "const x = <>{value}</>;",
		errors: [{ messageId: useNamedFragment }],
		filename,
		options: [element],
		output: "const x = <Fragment>{value}</Fragment>;",
	},
	// The configured fragment name is used.
	{
		code: "const x = <>{value}</>;",
		errors: [{ messageId: useNamedFragment }],
		filename,
		options: [{ fragmentName: "Frag", mode: "element" }],
		output: "const x = <Frag>{value}</Frag>;",
	},
	// Children (text and elements) are preserved.
	{
		code: "const x = <><span>a</span>{value}</>;",
		errors: [{ messageId: useNamedFragment }],
		filename,
		options: [element],
		output: "const x = <Fragment><span>a</span>{value}</Fragment>;",
	},
	// Nested shorthand fragments each report; the outer fix runs first.
	{
		code: "const x = <><>{value}</></>;",
		errors: [{ messageId: useNamedFragment }, { messageId: useNamedFragment }],
		filename,
		options: [element],
		output: "const x = <Fragment><Fragment>{value}</Fragment></Fragment>;",
	},
	// An empty shorthand fragment is rewritten.
	{
		code: "const x = <></>;",
		errors: [{ messageId: useNamedFragment }],
		filename,
		options: [element],
		output: "const x = <Fragment></Fragment>;",
	},
	// A member-expression name option produces a valid named fragment.
	{
		code: "const x = <>{value}</>;",
		errors: [{ messageId: useNamedFragment }],
		filename,
		options: [{ fragmentName: "React.Fragment", mode: "element" }],
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
