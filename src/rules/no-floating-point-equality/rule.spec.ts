import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { noFloatingPointEquality, RULE_NAME } from "./rule";

const messageId = "noExactFloatEquality";
const error = { messageId };

const valid: Array<ValidTestCase> = [
	"count === 3",
	"count !== 10 / 2",
	"x === 3 / 2",
	"x === 5 / 4",
	"x === 7 / 8",
	"codePoint === 0xFEFF",
	"timestamp === 1e15",
	"anchor === 0.5",
	"anchor === .25",
	"anchor === 1.2_5",
	"total === 1000 * 1.2",
	"total === (3 / 2) * 2",
	"imageWidth === CONTAINER_HEIGHT * 0.75",
	"expectedRemainder === total % 0.5",
	"result === expected",
	"x === 1 / 0",
	"x === -1 / 0",
	"x === 0 / 0",
	"x === (0.3 | 0)",
	"value < 4 || value > 5",
	"value <= 4 && value >= 5",
	"value <= 0.3 || value >= 0.3",
	"value < 0.3 && value > 0.3",
	"value <= 0.3 && other >= 0.3",
	"value <= 0.3 && value >= 0.4",
	"left.value <= 0.3 && right.value >= 0.3",
	"Math.abs(total - 0.3) < Number.EPSILON",
	"almostEqual(total, 0.3)",
	unindent`
		const exact = 4 / 2
		exact === 2
	`,
	unindent`
		const precision = 10 / 2
		total === precision
	`,
	unindent`
		const safeTotal = 1000 * 1.2
		total === safeTotal
	`,
	unindent`
		let mutable = 0.1 + 0.2
		mutable === expected
	`,
	unindent`
		const { expected } = { expected: 0.1 + 0.2 }
		actual === expected
	`,
	unindent`
		import { expected } from "./values"
		actual === expected
	`,
	unindent`
		function compare(expected: number) {
			return actual === expected
		}
	`,
	unindent`
		const first = second
		const second = first
		actual === first
	`,
	unindent`
		const expected = 0.1 + 0.2
		function compare() {
			const expected = 2
			return actual === expected
		}
	`,
	unindent`
		switch (count) {
			case 3:
			case 10 / 2:
				publish(count)
		}
	`,
	unindent`
		import { expect } from "vitest"
		expect(serviceFee(2)).toBeCloseTo(0.3)
	`,
	unindent`
		import { expect } from "vitest"
		expect(serviceFee(2)).toEqual(0.3)
	`,
	unindent`
		function expect(value: unknown) {
			return { toBe(expected: unknown) {} }
		}
		expect(0.1 + 0.2).toBe(0.3)
	`,
	unindent`
		expect(0.1 + 0.2).toBe(0.3)
	`,
	unindent`
		import { expect as chaiExpect } from "chai"
		chaiExpect(0.1 + 0.2).to.equal(0.3)
	`,
	unindent`
		import { expect } from "@playwright/test"
		expect(0.1 + 0.2).toBe(0.3)
	`,
	unindent`
		import "cypress"
		cy.wrap(price()).should("equal", 0.3)
	`,
	unindent`
		import assert from "node:assert/strict"
		assert.ok(almostEqual(taxAmount(1), 1 / 12))
	`,
	unindent`
		import { strictEqual } from "some-assertion-library"
		strictEqual(actual, 0.3)
	`,
	unindent`
		import { expect } from "vitest"
		function check(expect: (value: unknown) => any) {
			expect(actual).toBe(0.3)
		}
	`,
	unindent`
		import assert from "node:assert"
		function check(assert: { strictEqual(a: unknown, b: unknown): void }) {
			assert.strictEqual(actual, 0.3)
		}
	`,
];

const invalid: Array<InvalidTestCase> = [
	{ code: "if (total === 0.3) publish(total)", errors: [error] },
	{ code: "if (total === +0.3) publish(total)", errors: [error] },
	{ code: "if (delta !== -1e-12) publish(delta)", errors: [error] },
	{ code: "const status = total !== 0.3 ? 'retry' : 'settled'", errors: [error] },
	{ code: "getRatio() != 10 / 3", errors: [error] },
	{ code: "getRatio() != -10 / 3", errors: [error] },
	{ code: "0.1 + 0.2 == expected", errors: [error] },
	{ code: "amount * 0.0825 === expectedTax", errors: [error] },
	{ code: "actual === 1.1_1", errors: [error] },
	{ code: "actual === 0.000_001", errors: [error] },
	{ code: "average <= 1.1 && average >= 1.1", errors: [error] },
	{ code: "average >= 1.1 && average <= 1.1", errors: [error] },
	{ code: "1.1 >= average && 1.1 <= average", errors: [error] },
	{ code: "1.1 <= average && average <= 1.1", errors: [error] },
	{ code: "conversionRate < 10 / 3 || conversionRate > 10 / 3", errors: [error] },
	{ code: "conversionRate > 10 / 3 || conversionRate < 10 / 3", errors: [error] },
	{ code: "10 / 3 < conversionRate || conversionRate < 10 / 3", errors: [error] },
	{
		code: "(conversionRate + offset) < 0.3 || (conversionRate + offset) > 0.3",
		errors: [error],
	},
	{
		code: unindent`
			const averageScore = (0.8 + 0.3) / 2
			averageScore <= 0.55 && averageScore >= 0.55
		`,
		errors: [error],
	},
	{
		code: unindent`
			const expectedTotal = 0.1 + 0.2
			actualTotal === expectedTotal
		`,
		errors: [error],
	},
	{
		code: unindent`
			const rawTotal = 0.1 + 0.2
			const expectedTotal = rawTotal
			actualTotal === expectedTotal
		`,
		errors: [error],
	},
	{
		code: unindent`
			const a = b
			const b = c
			const c = 0.3
			actual === a
		`,
		errors: [error],
	},
	{
		code: unindent`
			const expected = 0.1 + 0.2
			function compare() {
				return actual === expected
			}
		`,
		errors: [error],
	},
	{
		code: unindent`
			switch (total) {
				case 0.3:
					break
				case 1 / 3:
					break
				default:
			}
		`,
		errors: [error, error],
	},
	{
		code: unindent`
			const expected = 0.1 + 0.2
			switch (total) {
				case expected:
					break
			}
		`,
		errors: [error],
	},
	{
		code: unindent`
			import { expect, test } from "vitest"
			test("total", () => {
				expect(0.1 + 0.2).toBe(0.3)
			})
		`,
		errors: [error],
	},
	{
		code: unindent`
			import { expect as verify } from "@jest/globals"
			verify(actual).not.toBe(0.4)
		`,
		errors: [error],
	},
	{
		code: unindent`
			import { expect as bunExpect } from "bun:test"
			bunExpect(actual)["toBe"](0.3)
		`,
		errors: [error],
	},
	{
		code: unindent`
			import assert from "node:assert/strict"
			assert.strictEqual(taxAmount(1), 1 / 12)
			assert.notStrictEqual(taxAmount(1), 1 / 12)
		`,
		errors: [error, error],
	},
	{
		code: unindent`
			import * as assert from "node:assert"
			assert.strictEqual(actual, 0.3)
		`,
		errors: [error],
	},
	{
		code: unindent`
			import nodeAssert from "assert/strict"
			nodeAssert["notStrictEqual"](actual, 0.3)
		`,
		errors: [error],
	},
	{
		code: unindent`
			import { strictEqual } from "assert"
			strictEqual(actual, 0.3)
		`,
		errors: [error],
	},
	{
		code: unindent`
			import { notStrictEqual as differs } from "node:assert/strict"
			differs(actual, 0.3, "message")
		`,
		errors: [error],
	},
];

run({
	name: RULE_NAME,
	invalid,
	parserOptions: {
		ecmaVersion: "latest",
		sourceType: "module",
	},
	rule: noFloatingPointEquality,
	valid,
});
