import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { noConditionalEmptyObjectSpread, RULE_NAME } from "./rule";

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
		errors: [{ messageId }],
		output: null,
	},
	{
		code: unindent`
			const options = {
				...(timeout === undefined ? {} : { timeout }),
			};
		`,
		errors: [{ messageId }],
		output: null,
	},
	{
		code: unindent`
			const options = {
				...(enabled ? defaults : {}),
			};
		`,
		errors: [{ messageId }],
		output: null,
	},
	{
		code: unindent`
			const options = {
				...((enabled ? { enabled } : {})),
			};
		`,
		errors: [{ messageId }],
		output: null,
	},
	{
		code: unindent`
			const options = {
				...(enabled ? {} : {}),
			};
		`,
		errors: [{ messageId }],
		output: null,
	},
	{
		code: unindent`
			const options = {
				...(first ? { first } : {}),
				...(second ? {} : { second }),
			};
		`,
		errors: [{ messageId }, { messageId }],
		output: null,
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: noConditionalEmptyObjectSpread,
	valid,
});
