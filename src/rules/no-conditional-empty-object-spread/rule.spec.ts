import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { noConditionalEmptyObjectSpread, RULE_NAME } from "./rule";

const messageId = "avoid";

const valid: Array<ValidTestCase> = [];

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
];

run({
	name: RULE_NAME,
	invalid,
	rule: noConditionalEmptyObjectSpread,
	valid,
});
