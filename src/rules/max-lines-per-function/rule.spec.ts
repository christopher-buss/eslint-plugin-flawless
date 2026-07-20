import type { InvalidTestCase, ValidTestCase } from "eslint-vitest-rule-tester";
import { expect, it } from "vitest";

import { run } from "../test";
import { maxLinesPerFunction, RULE_NAME } from "./rule";

const exceed = "exceed";

// Ported from ESLint core's `tests/lib/rules/max-lines-per-function.js`
// (v9.39.4). Core's bare-integer shorthand (`options: [4]`) is not supported
// here, so those cases are rewritten as `options: [{ max: 4 }]`; they exercise
// the counter, not the schema, so nothing is lost. Sources deliberately keep
// core's literal `\n` strings rather than `unindent`, because several cases hinge
// on lines holding only a tab or a single space — `unindent` would strip that.
const valid: Array<ValidTestCase> = [
	// Code in global scope is not counted.
	{
		code: "var x = 5;\nvar x = 2;\n",
		options: [{ max: 1 }],
	},
	// A single-line standalone function.
	{
		code: "function name() {}",
		options: [{ max: 1 }],
	},
	// A standalone function sitting exactly on the limit.
	{
		code: "function name() {\nvar x = 5;\nvar x = 2;\n}",
		options: [{ max: 4 }],
	},
	// An inline arrow function.
	{
		code: "const bar = () => 2",
		options: [{ max: 1 }],
	},
	// An arrow function with a block body.
	{
		code: "const bar = () => {\nconst x = 2 + 1;\nreturn x;\n}",
		options: [{ max: 4 }],
	},
	// skipBlankLines: false counts the whitespace-only lines.
	{
		code: "function name() {\nvar x = 5;\n\t\n \n\nvar x = 2;\n}",
		options: [{ max: 7, skipBlankLines: false, skipComments: false }],
	},
	// skipBlankLines: true drops them.
	{
		code: "function name() {\nvar x = 5;\n\t\n \n\nvar x = 2;\n}",
		options: [{ max: 4, skipBlankLines: true, skipComments: false }],
	},
	// A comment trailing real code does not make the line skippable.
	{
		code: "function name() {\nvar x = 5;\nvar x = 2; // end of line comment\n}",
		options: [{ max: 4, skipBlankLines: false, skipComments: true }],
	},
	// An own-line comment is skipped; a trailing one is not.
	{
		code: "function name() {\nvar x = 5;\n// a comment on it's own line\nvar x = 2; // end of line comment\n}",
		options: [{ max: 4, skipBlankLines: false, skipComments: true }],
	},
	// Consecutive own-line comments are each skipped.
	{
		code: "function name() {\nvar x = 5;\n// a comment on it's own line\n// and another line comment\nvar x = 2; // end of line comment\n}",
		options: [{ max: 4, skipBlankLines: false, skipComments: true }],
	},
	// Every line of a multi-line block comment is skipped.
	{
		code: "function name() {\nvar x = 5;\n/* a \n multi \n line \n comment \n*/\n\nvar x = 2; // end of line comment\n}",
		options: [{ max: 5, skipBlankLines: false, skipComments: true }],
	},
	// Whitespace around a comment still leaves it own-line.
	{
		code: "function name() {\nvar x = 5;\n\t/* a comment with leading whitespace */\n/* a comment with trailing whitespace */\t\t\n\t/* a comment with trailing and leading whitespace */\t\t\n/* a \n multi \n line \n comment \n*/\t\t\n\nvar x = 2; // end of line comment\n}",
		options: [{ max: 5, skipBlankLines: false, skipComments: true }],
	},
	// Parameters spread over separate lines are counted (core behaviour).
	{
		code: `function foo(
    aaa = 1,
    bbb = 2,
    ccc = 3
) {
    return aaa + bbb + ccc
}`,
		options: [{ max: 7, skipBlankLines: false, skipComments: true }],
	},
	// An IIFE spread over several lines, under the limit.
	{
		code: `(
function
()
{
}
)
()`,
		options: [{ IIFEs: true, max: 4, skipBlankLines: false, skipComments: true }],
	},
	// A nested function's lines also count toward its parent.
	{
		code: `function parent() {
var x = 0;
function nested() {
    var y = 0;
    x = 2;
}
if ( x === y ) {
    x++;
}
}`,
		options: [{ max: 10, skipBlankLines: false, skipComments: true }],
	},
	// A class method under the limit.
	{
		code: `class foo {
    method() {
        let y = 10;
        let x = 20;
        return y + x;
    }
}`,
		options: [{ max: 5, skipBlankLines: false, skipComments: true }],
	},
	// IIFEs are measured when IIFEs: true.
	{
		code: `(function(){
    let x = 0;
    let y = 0;
    let z = x + y;
    let foo = {};
    return bar;
}());`,
		options: [{ IIFEs: true, max: 7, skipBlankLines: false, skipComments: true }],
	},
	// IIFEs are skipped entirely when IIFEs: false, however long they are.
	{
		code: `(function(){
    let x = 0;
    let y = 0;
    let z = x + y;
    let foo = {};
    return bar;
}());`,
		options: [{ IIFEs: false, max: 2, skipBlankLines: false, skipComments: true }],
	},
	// The same, for an arrow IIFE.
	{
		code: `(() => {
    let x = 0;
    let y = 0;
    let z = x + y;
    let foo = {};
    return bar;
})();`,
		options: [{ IIFEs: true, max: 7, skipBlankLines: false, skipComments: true }],
	},
	{
		code: `(() => {
    let x = 0;
    let y = 0;
    let z = x + y;
    let foo = {};
    return bar;
})();`,
		options: [{ IIFEs: false, max: 2, skipBlankLines: false, skipComments: true }],
	},
	// Overload signatures have no body, so only the implementation is measured.
	{
		code: `function foo(a: string): void;
function foo(a: number): void;
function foo(a: unknown): void {
	return;
}`,
		options: [{ max: 3 }],
	},
	// An abstract method has no body and is never reported.
	{
		code: `abstract class A {
	abstract foo(
		a: string,
		b: string,
	): void;
}`,
		options: [{ max: 1 }],
	},
	// A declared function has no body and is never reported.
	{
		code: `declare function foo(
	a: string,
	b: string,
): void;`,
		options: [{ max: 1 }],
	},
];

const invalid: Array<InvalidTestCase> = [
	// A simple standalone function is recognized.
	{
		code: "function name() {\n}",
		errors: [
			{
				column: 1,
				data: { name: "Function 'name'", lineCount: 2, maxLines: 1 },
				endColumn: 14,
				endLine: 1,
				line: 1,
				messageId: exceed,
			},
		],
		options: [{ max: 1 }],
	},
	// An anonymous function expression is named just "Function".
	{
		code: "var func = function() {\n}",
		errors: [
			{
				column: 12,
				data: { name: "Function", lineCount: 2, maxLines: 1 },
				endColumn: 20,
				endLine: 1,
				line: 1,
				messageId: exceed,
			},
		],
		options: [{ max: 1 }],
	},
	// An arrow assigned to a variable is plain "Arrow function": it has no `id`,
	// and its parent is a VariableDeclarator rather than a Property.
	{
		code: "const bar = () => {\nconst x = 2 + 1;\nreturn x;\n}",
		errors: [
			{
				column: 16,
				data: { name: "Arrow function", lineCount: 4, maxLines: 3 },
				endColumn: 18,
				endLine: 1,
				line: 1,
				messageId: exceed,
			},
		],
		options: [{ max: 3 }],
	},
	// A concise arrow body spanning two lines.
	{
		code: "const bar = () =>\n 2",
		errors: [
			{
				column: 16,
				data: { name: "Arrow function", lineCount: 2, maxLines: 1 },
				endColumn: 18,
				endLine: 1,
				line: 1,
				messageId: exceed,
			},
		],
		options: [{ max: 1 }],
	},
	// An empty options object falls back to max: 50.
	{
		code: `() => {${"foo\n".repeat(60)}}`,
		errors: [
			{
				column: 4,
				data: { name: "Arrow function", lineCount: 61, maxLines: 50 },
				endColumn: 6,
				endLine: 1,
				line: 1,
				messageId: exceed,
			},
		],
		options: [{}],
	},
	// skipBlankLines: false counts every whitespace-only line.
	{
		code: "function name() {\nvar x = 5;\n\t\n \n\nvar x = 2;\n}",
		errors: [
			{
				column: 1,
				data: { name: "Function 'name'", lineCount: 7, maxLines: 6 },
				endColumn: 14,
				endLine: 1,
				line: 1,
				messageId: exceed,
			},
		],
		options: [{ max: 6, skipBlankLines: false, skipComments: false }],
	},
	// The same, with CRLF line endings.
	{
		code: "function name() {\r\nvar x = 5;\r\n\t\r\n \r\n\r\nvar x = 2;\r\n}",
		errors: [
			{
				column: 1,
				data: { name: "Function 'name'", lineCount: 7, maxLines: 6 },
				endColumn: 14,
				endLine: 1,
				line: 1,
				messageId: exceed,
			},
		],
		options: [{ max: 6, skipBlankLines: false, skipComments: true }],
	},
	// skipBlankLines: true drops them.
	{
		code: "function name() {\nvar x = 5;\n\t\n \n\nvar x = 2;\n}",
		errors: [
			{
				column: 1,
				data: { name: "Function 'name'", lineCount: 4, maxLines: 2 },
				endColumn: 14,
				endLine: 1,
				line: 1,
				messageId: exceed,
			},
		],
		options: [{ max: 2, skipBlankLines: true, skipComments: true }],
	},
	// The same, with CRLF line endings.
	{
		code: "function name() {\r\nvar x = 5;\r\n\t\r\n \r\n\r\nvar x = 2;\r\n}",
		errors: [
			{
				column: 1,
				data: { name: "Function 'name'", lineCount: 4, maxLines: 2 },
				endColumn: 14,
				endLine: 1,
				line: 1,
				messageId: exceed,
			},
		],
		options: [{ max: 2, skipBlankLines: true, skipComments: true }],
	},
	// skipComments only drops own-line comments, not trailing or mid-line ones.
	{
		code: "function name() { // end of line comment\nvar x = 5; /* mid line comment */\n\t// single line comment taking up whole line\n\t\n \n\nvar x = 2;\n}",
		errors: [
			{
				column: 1,
				data: { name: "Function 'name'", lineCount: 7, maxLines: 6 },
				endColumn: 14,
				endLine: 1,
				line: 1,
				messageId: exceed,
			},
		],
		options: [{ max: 6, skipBlankLines: false, skipComments: true }],
	},
	// Both skips together.
	{
		code: "function name() { // end of line comment\nvar x = 5; /* mid line comment */\n\t// single line comment taking up whole line\n\t\n \n\nvar x = 2;\n}",
		errors: [
			{
				column: 1,
				data: { name: "Function 'name'", lineCount: 4, maxLines: 1 },
				endColumn: 14,
				endLine: 1,
				line: 1,
				messageId: exceed,
			},
		],
		options: [{ max: 1, skipBlankLines: true, skipComments: true }],
	},
	// Blank lines only.
	{
		code: "function name() { // end of line comment\nvar x = 5; /* mid line comment */\n\t// single line comment taking up whole line\n\t\n \n\nvar x = 2;\n}",
		errors: [
			{
				column: 1,
				data: { name: "Function 'name'", lineCount: 5, maxLines: 1 },
				endColumn: 14,
				endLine: 1,
				line: 1,
				messageId: exceed,
			},
		],
		options: [{ max: 1, skipBlankLines: true, skipComments: false }],
	},
	// Parameters on separate lines inflate the count — the behaviour the
	// `countFrom` option changes in the commit that follows.
	{
		code: `function foo(
    aaa = 1,
    bbb = 2,
    ccc = 3
) {
    return aaa + bbb + ccc
}`,
		errors: [
			{
				column: 1,
				data: { name: "Function 'foo'", lineCount: 7, maxLines: 2 },
				endColumn: 13,
				endLine: 1,
				line: 1,
				messageId: exceed,
			},
		],
		options: [{ max: 2, skipBlankLines: false, skipComments: true }],
	},
	// The IIFE's `function` keyword line is included in the count.
	{
		code: `(
function
()
{
}
)
()`,
		errors: [
			{
				column: 1,
				data: { name: "Function", lineCount: 4, maxLines: 2 },
				endColumn: 1,
				endLine: 3,
				line: 2,
				messageId: exceed,
			},
		],
		options: [{ IIFEs: true, max: 2, skipBlankLines: false, skipComments: true }],
	},
	// A nested function's lines count toward its parent too.
	{
		code: `function parent() {
var x = 0;
function nested() {
    var y = 0;
    x = 2;
}
if ( x === y ) {
    x++;
}
}`,
		errors: [
			{
				column: 1,
				data: { name: "Function 'parent'", lineCount: 10, maxLines: 9 },
				endColumn: 16,
				endLine: 1,
				line: 1,
				messageId: exceed,
			},
		],
		options: [{ max: 9, skipBlankLines: false, skipComments: true }],
	},
	// Parent and nested are reported independently.
	{
		code: `function parent() {
var x = 0;
function nested() {
    var y = 0;
    x = 2;
}
if ( x === y ) {
    x++;
}
}`,
		errors: [
			{
				column: 1,
				data: { name: "Function 'parent'", lineCount: 10, maxLines: 2 },
				endColumn: 16,
				endLine: 1,
				line: 1,
				messageId: exceed,
			},
			{
				column: 1,
				data: { name: "Function 'nested'", lineCount: 4, maxLines: 2 },
				endColumn: 16,
				endLine: 3,
				line: 3,
				messageId: exceed,
			},
		],
		options: [{ max: 2, skipBlankLines: false, skipComments: true }],
	},
	// A class method is measured and reported as the MethodDefinition.
	{
		code: `class foo {
    method() {
        let y = 10;
        let x = 20;
        return y + x;
    }
}`,
		errors: [
			{
				column: 5,
				data: { name: "Method 'method'", lineCount: 5, maxLines: 2 },
				endColumn: 11,
				endLine: 2,
				line: 2,
				messageId: exceed,
			},
		],
		options: [{ max: 2, skipBlankLines: false, skipComments: true }],
	},
	// A static method, with its modifier and name on separate lines.
	{
		code: `class A {
    static
    foo
    (a) {
        return a
    }
}`,
		errors: [
			{
				column: 5,
				data: { name: "Static method 'foo'", lineCount: 5, maxLines: 2 },
				endColumn: 5,
				endLine: 4,
				line: 2,
				messageId: exceed,
			},
		],
		options: [{ max: 2, skipBlankLines: false, skipComments: true }],
	},
	// An object getter.
	{
		code: `var obj = {
    get
    foo
    () {
        return 1
    }
}`,
		errors: [
			{
				column: 5,
				data: { name: "Getter 'foo'", lineCount: 5, maxLines: 2 },
				endColumn: 5,
				endLine: 4,
				line: 2,
				messageId: exceed,
			},
		],
		options: [{ max: 2, skipBlankLines: false, skipComments: true }],
	},
	// An object setter.
	{
		code: `var obj = {
    set
    foo
    ( val ) {
        this._foo = val;
    }
}`,
		errors: [
			{
				column: 5,
				data: { name: "Setter 'foo'", lineCount: 5, maxLines: 2 },
				endColumn: 5,
				endLine: 4,
				line: 2,
				messageId: exceed,
			},
		],
		options: [{ max: 2, skipBlankLines: false, skipComments: true }],
	},
	// A computed key yields no name at all.
	{
		code: `class A {
    static
    [
        foo +
            bar
    ]
    (a) {
        return a
    }
}`,
		errors: [
			{
				column: 5,
				data: { name: "Static method", lineCount: 8, maxLines: 2 },
				endColumn: 5,
				endLine: 7,
				line: 2,
				messageId: exceed,
			},
		],
		options: [{ max: 2, skipBlankLines: false, skipComments: true }],
	},
	// IIFEs: true measures a function IIFE.
	{
		code: `(function(){
    let x = 0;
    let y = 0;
    let z = x + y;
    let foo = {};
    return bar;
}());`,
		errors: [
			{
				column: 2,
				data: { name: "Function", lineCount: 7, maxLines: 2 },
				endColumn: 10,
				endLine: 1,
				line: 1,
				messageId: exceed,
			},
		],
		options: [{ IIFEs: true, max: 2, skipBlankLines: false, skipComments: true }],
	},
	// IIFEs: true measures an arrow IIFE.
	{
		code: `(() => {
    let x = 0;
    let y = 0;
    let z = x + y;
    let foo = {};
    return bar;
})();`,
		errors: [
			{
				column: 5,
				data: { name: "Arrow function", lineCount: 7, maxLines: 2 },
				endColumn: 7,
				endLine: 1,
				line: 1,
				messageId: exceed,
			},
		],
		options: [{ IIFEs: true, max: 2, skipBlankLines: false, skipComments: true }],
	},
	// Only the overload implementation is measured, not the signatures.
	{
		code: `function foo(a: string): void;
function foo(a: number): void;
function foo(a: unknown): void {
	return;
}`,
		errors: [
			{
				data: { name: "Function 'foo'", lineCount: 3, maxLines: 2 },
				line: 3,
				messageId: exceed,
			},
		],
		options: [{ max: 2 }],
	},
	// A decorator sits inside the MethodDefinition's range, so it is counted.
	// The exact count is pinned here so the `countFrom` commit cannot change it
	// silently.
	{
		code: `class A {
	@dec
	method() {
		return 1;
	}
}`,
		errors: [
			{
				data: { name: "Method 'method'", lineCount: 4, maxLines: 2 },
				messageId: exceed,
			},
		],
		options: [{ max: 2 }],
	},
];

run({
	name: RULE_NAME,
	invalid,
	// Not type-aware: the shared defaults pin a `project` whose only files are
	// `fixtures/file.ts` and `fixtures/file.tsx`.
	parserOptions: { ecmaVersion: "latest", sourceType: "module" },
	rule: maxLinesPerFunction,
	valid,
});

it("takes only an options object, not core's bare-integer shorthand", () => {
	expect(maxLinesPerFunction.meta.schema).toStrictEqual([
		expect.objectContaining({ additionalProperties: false, type: "object" }),
	]);
});
