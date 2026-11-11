import { unindent } from "eslint-vitest-rule-tester";
import type { InvalidTestCase, ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test.ts";
import { noConditionalEmptyObjectSpread, RULE_NAME } from "./rule.ts";

const messageId = "avoid";

const valid: Array<ValidTestCase> = [
	unindent`
		const options = { timeout };
	`,
	unindent`
		const options = { ...defaults };
	`,
	unindent`
		const options = {
			...(enabled ? { timeout } : { retries }),
		};
	`,
	unindent`
		const options = {
			...(enabled ? [] : []),
		};
	`,
	unindent`
		const values = [
			...(enabled ? [] : []),
		];
	`,
];

const invalid: Array<InvalidTestCase> = [
	{
		code: unindent`
			const options = {
				...(timeout !== undefined ? { timeout } : {}),
			};
		`,
		output: null,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			const options = {
				...(timeout === undefined ? {} : { timeout }),
			};
		`,
		output: null,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			const options = {
				...(enabled ? defaults : {}),
			};
		`,
		output: null,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			const options = {
				...((enabled ? { enabled } : {})),
			};
		`,
		output: null,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			const options = {
				...(enabled ? {} : {}),
			};
		`,
		output: null,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			const options = {
				...(first ? { first } : {}),
				...(second ? {} : { second }),
			};
		`,
		output: null,
		errors: [{ messageId }, { messageId }],
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: noConditionalEmptyObjectSpread,
	valid,
});
