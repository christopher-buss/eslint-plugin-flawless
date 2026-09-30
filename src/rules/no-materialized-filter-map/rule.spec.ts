import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { run } from "../test";
import { noMaterializedFilterMap, RULE_NAME } from "./rule";

const messageId = "materialized";
const noHelpersMessageId = "materializedNoHelpers";
const suggestMessageId = "chainOnIterator";

interface SuggestionCase {
	readonly code: string;
	/** The output of the one suggestion, or null when the report offers none. */
	readonly suggestion: null | string;
}

/**
 * A report without an autofix. The tester matches suggestions by message only,
 * so this applies the suggestion's fix and compares the text itself.
 *
 * @param testCase - The code, and the text the suggestion should produce.
 * @returns The invalid test case.
 */
function suggestionCase({ code, suggestion }: SuggestionCase): InvalidTestCase {
	return {
		code,
		errors(messages): void {
			expect(messages).toHaveLength(1);
			const [message] = messages;
			expect(message?.messageId).toBe(messageId);
			expect(message?.fix).toBeUndefined();
			if (suggestion === null) {
				expect(message?.suggestions).toBeUndefined();
				return;
			}

			expect(message?.suggestions).toHaveLength(1);
			const [entry] = message?.suggestions ?? [];
			expect(entry?.messageId).toBe(suggestMessageId);
			const range = entry?.fix.range ?? [0, 0];
			const fixed = code.slice(0, range[0]) + (entry?.fix.text ?? "") + code.slice(range[1]);
			expect(fixed).toBe(suggestion);
		},
		output: null,
	};
}

const valid: Array<ValidTestCase> = [
	// An eager chain on an array makes one extra array, and is normal code.
	unindent`
		declare const array: Array<{ name?: string }>;

		export const names = array.map((t) => t.name).filter((n): n is string => n !== undefined);
	`,
	// Copying an array only drops a copy; that is not this rule's subject.
	unindent`
		declare const array: Array<number>;

		export const doubled = [...array].filter((n) => n > 0).map((n) => n * 2);
	`,
	unindent`
		declare const tuple: readonly [number, number];

		export const doubled = [...tuple].map((n) => n * 2);
	`,
	unindent`
		declare const array: ReadonlyArray<number>;

		export const doubled = Array.from(array).map((n) => n * 2);
	`,
	// Nothing is known about \`any\`.
	unindent`
		declare const value: any;

		export const doubled = [...value].map((n) => n * 2);
	`,
	// A union with a member that is not iterable.
	unindent`
		declare const value: Set<number> | number;

		export const doubled = [...value].map((n) => n * 2);
	`,
	unindent`
		declare const value: Set<number> | undefined;

		export const doubled = [...value].map((n) => n * 2);
	`,
	// Spreading a string into characters is its own idiom.
	unindent`
		declare const text: string;

		export const letters = [...text].filter((c) => c !== " ");
	`,
	// Already lazy.
	unindent`
		declare const set: Set<number>;

		export const doubled = set.values().filter((n) => n > 0).map((n) => n * 2).toArray();
	`,
	// The copy is not followed by \`filter\` or \`map\`.
	unindent`
		declare const set: Set<number>;

		export const sorted = [...set].sort((a, b) => a - b);
	`,
	unindent`
		declare const set: Set<number>;

		export const total = [...set].reduce((sum, n) => sum + n, 0);
	`,
	// More than one element is not a plain copy.
	unindent`
		declare const set: Set<number>;

		export const doubled = [...set, 1].map((n) => n * 2);
	`,
	// A mapping \`Array.from\` is out of scope.
	unindent`
		declare const set: Set<number>;

		export const doubled = Array.from(set, (n) => n * 2).filter((n) => n > 0);
	`,
	unindent`
		const Array = { from: (value: Set<number>) => [...value.values()] };
		declare const set: Set<number>;

		export const doubled = Array.from(set).map((n) => n * 2);
	`,
	// An array-like without an iterator.
	unindent`
		export const indexes = Array.from({ length: 3 }).map((_, index) => index);
	`,
	// A type assertion in between hides the chain.
	unindent`
		declare const set: Set<number>;

		export const doubled = ([...set] as Array<number>).map((n) => n * 2);
	`,
	unindent`
		declare const set: Set<number>;

		export const doubled = [...set]["map"]((n) => n * 2);
	`,
];

const invalid: Array<InvalidTestCase> = [
	// --- Autofix: built-in source, inline side-effect-free callbacks ---
	{
		code: unindent`
			declare const set: Set<number>;

			export const doubled = [...set].filter((n) => n > 0).map((n) => n * 2);
		`,
		errors: [{ data: { chain: ".filter().map()", copy: "[...]" }, messageId }],
		output: unindent`
			declare const set: Set<number>;

			export const doubled = set.values().filter((n) => n > 0).map((n) => n * 2).toArray();
		`,
	},
	// A spread of a Map yields its entries.
	{
		code: unindent`
			declare const map: Map<string, number>;

			export const keys = [...map].map(([key]) => key);
		`,
		errors: [{ messageId }],
		output: unindent`
			declare const map: Map<string, number>;

			export const keys = map.entries().map(([key]) => key).toArray();
		`,
	},
	{
		code: unindent`
			declare const map: ReadonlyMap<string, number>;

			export const keys = Array.from(map.keys()).filter((key) => key !== "a");
		`,
		errors: [{ data: { chain: ".filter()", copy: "Array.from()" }, messageId }],
		output: unindent`
			declare const map: ReadonlyMap<string, number>;

			export const keys = map.keys().filter((key) => key !== "a").toArray();
		`,
	},
	{
		code: unindent`
			declare const set: ReadonlySet<number>;

			export const odd = [...set].map((n) => n * 3).filter((n) => n % 2 === 1).map((n) => n - 1);
		`,
		errors: [{ data: { chain: ".map().filter().map()", copy: "[...]" }, messageId }],
		output: unindent`
			declare const set: ReadonlySet<number>;

			export const odd = set.values().map((n) => n * 3).filter((n) => n % 2 === 1).map((n) => n - 1).toArray();
		`,
	},
	// The counter a helper passes is the index in the intermediate array, so a
	// second parameter is kept. The result stays an array for the later spread.
	{
		code: unindent`
			declare const map: Map<string, number>;

			const names = [...map.keys()]
				.filter((name) => name !== "")
				.map((name, index) => \`\${index}:\${name}\`);

			export const all = [...names, "end"];
		`,
		errors: [{ messageId }],
		output: unindent`
			declare const map: Map<string, number>;

			const names = map.keys()
				.filter((name) => name !== "")
				.map((name, index) => \`\${index}:\${name}\`).toArray();

			export const all = [...names, "end"];
		`,
	},
	// A union with an array goes through \`Iterator.from\`, which reads the same
	// \`[Symbol.iterator]\` the spread reads. \`new Map\` takes any iterable.
	{
		code: unindent`
			declare const maybeMap: Map<string, number> | undefined;

			export const positive = new Map(
				[...(maybeMap ?? [])].filter(([, value]) => value > 0).map(([key, value]) => [key, value * 2]),
			);
		`,
		errors: [{ messageId }],
		output: unindent`
			declare const maybeMap: Map<string, number> | undefined;

			export const positive = new Map(
				Iterator.from(maybeMap ?? []).filter(([, value]) => value > 0).map(([key, value]) => [key, value * 2]),
			);
		`,
	},
	{
		code: unindent`
			interface Graph {
				readonly nodes: Map<string, { readonly weight: number }>;
			}
			declare const graph: Graph;

			export const heavy = new Map([...graph.nodes].filter(([, node]) => node.weight > 1).map(([id, node]) => [id, node.weight]));
		`,
		errors: [{ messageId }],
		output: unindent`
			interface Graph {
				readonly nodes: Map<string, { readonly weight: number }>;
			}
			declare const graph: Graph;

			export const heavy = new Map(graph.nodes.entries().filter(([, node]) => node.weight > 1).map(([id, node]) => [id, node.weight]));
		`,
	},
	// Sinks that take any iterable get no `.toArray()`.
	{
		code: unindent`
			declare const set: Set<number>;

			export const copy = [...[...set].map((n) => n + 1)];
			export const unique = new Set([...set].map((n) => n % 3));
			export const array = Array.from([...set].filter((n) => n > 0));
			export const max = Math.max(...[...set].map((n) => n * 2));
		`,
		errors: [{ messageId }, { messageId }, { messageId }, { messageId }],
		output: unindent`
			declare const set: Set<number>;

			export const copy = [...set.values().map((n) => n + 1)];
			export const unique = new Set(set.values().map((n) => n % 3));
			export const array = Array.from(set.values().filter((n) => n > 0));
			export const max = Math.max(...set.values().map((n) => n * 2));
		`,
	},
	// An object spread reads own keys, which an iterator lacks.
	{
		code: unindent`
			declare const set: Set<number>;

			export const byIndex = { ...[...set].map((n) => n + 1) };
		`,
		errors: [{ messageId }],
		output: unindent`
			declare const set: Set<number>;

			export const byIndex = { ...set.values().map((n) => n + 1).toArray() };
		`,
	},
	// A chain that goes on past `map` still needs an array there.
	{
		code: unindent`
			declare const set: Set<number>;

			export const text = [...set].map((n) => n * 2).join(",");
		`,
		errors: [{ messageId }],
		output: unindent`
			declare const set: Set<number>;

			export const text = set.values().map((n) => n * 2).toArray().join(",");
		`,
	},
	// Parentheses around the copy are kept; an iterable that needs them to take
	// a member access gets them.
	{
		code: unindent`
			declare const set: Set<number>;

			export const doubled = ([...set]).map((n) => n * 2);
		`,
		errors: [{ messageId }],
		output: unindent`
			declare const set: Set<number>;

			export const doubled = (set.values()).map((n) => n * 2).toArray();
		`,
	},
	{
		code: unindent`
			declare const first: Set<number> | undefined;
			declare const second: Set<number>;

			export const doubled = [...(first ?? second)].map((n) => n * 2);
		`,
		errors: [{ messageId }],
		output: unindent`
			declare const first: Set<number> | undefined;
			declare const second: Set<number>;

			export const doubled = (first ?? second).values().map((n) => n * 2).toArray();
		`,
	},
	// A keyword directly before the copy keeps a space before the new text.
	{
		code: unindent`
			declare const set: Set<number>;

			export function double(): void {
				void[...set].map((n) => n * 2);
			}
		`,
		errors: [{ messageId }],
		output: unindent`
			declare const set: Set<number>;

			export function double(): void {
				void set.values().map((n) => n * 2).toArray();
			}
		`,
	},
	{
		code: unindent`
			declare const set: Set<number>;

			export function double() {
				return[...set].map((n) => n * 2);
			}
		`,
		errors: [{ messageId }],
		output: unindent`
			declare const set: Set<number>;

			export function double() {
				return set.values().map((n) => n * 2).toArray();
			}
		`,
	},
	// A type guard narrows through the helper's own type-guard overload.
	{
		code: unindent`
			declare const set: Set<string | undefined>;

			export const defined: Array<string> = [...set].filter((v): v is string => v !== undefined);
		`,
		errors: [{ messageId }],
		output: unindent`
			declare const set: Set<string | undefined>;

			export const defined: Array<string> = set.values().filter((v): v is string => v !== undefined).toArray();
		`,
	},
	{
		code: unindent`
			declare const set: Set<number>;

			export const doubled = [...set].map(function (n) {
				return n * 2;
			});
		`,
		errors: [{ messageId }],
		output: unindent`
			declare const set: Set<number>;

			export const doubled = set.values().map(function (n) {
				return n * 2;
			}).toArray();
		`,
	},

	// --- Suggestion: the change could be observed ---
	// A call in a callback may have an effect that lazy interleaving reorders.
	suggestionCase({
		code: unindent`
			declare const set: Set<number>;
			declare function isValid(n: number): boolean;

			export const valid = [...set].filter((n) => isValid(n)).map((n) => n * 2);
		`,
		suggestion: unindent`
			declare const set: Set<number>;
			declare function isValid(n: number): boolean;

			export const valid = set.values().filter((n) => isValid(n)).map((n) => n * 2).toArray();
		`,
	}),
	suggestionCase({
		code: unindent`
			declare const set: Set<number>;
			let total = 0;

			export const seen = [...set].map((n) => {
				total += n;
				return total;
			});
		`,
		suggestion: unindent`
			declare const set: Set<number>;
			let total = 0;

			export const seen = set.values().map((n) => {
				total += n;
				return total;
			}).toArray();
		`,
	}),
	// A reference may read a third argument.
	suggestionCase({
		code: unindent`
			declare const set: Set<number | undefined>;

			export const present = [...set].filter(Boolean);
		`,
		suggestion: unindent`
			declare const set: Set<number | undefined>;

			export const present = set.values().filter(Boolean).toArray();
		`,
	}),
	// A generator runs user code on every step, which interleaves with the
	// callbacks.
	suggestionCase({
		code: unindent`
			function* count(): Generator<number> {
				yield 1;
			}

			export const doubled = [...count()].map((n) => n * 2);
		`,
		suggestion: unindent`
			function* count(): Generator<number> {
				yield 1;
			}

			export const doubled = count().map((n) => n * 2).toArray();
		`,
	}),
	// A user iterable, including a subclass of Map, may override its iterator.
	suggestionCase({
		code: unindent`
			class Registry extends Map<string, number> {}
			declare const registry: Registry;

			export const keys = [...registry].map(([key]) => key);
		`,
		suggestion: unindent`
			class Registry extends Map<string, number> {}
			declare const registry: Registry;

			export const keys = Iterator.from(registry).map(([key]) => key).toArray();
		`,
	}),
	// A loop body would run between the callbacks, and could change the source.
	suggestionCase({
		code: unindent`
			declare const set: Set<number>;

			for (const n of [...set].filter((n) => n > 0)) {
				set.delete(n);
			}
		`,
		suggestion: unindent`
			declare const set: Set<number>;

			for (const n of set.values().filter((n) => n > 0)) {
				set.delete(n);
			}
		`,
	}),

	// A parameter default runs on every call, like the body.
	suggestionCase({
		code: unindent`
			declare const set: Set<{ readonly size?: number }>;
			declare function measure(): number;

			export const sizes = [...set].map(({ size = measure() }) => size);
		`,
		suggestion: unindent`
			declare const set: Set<{ readonly size?: number }>;
			declare function measure(): number;

			export const sizes = set.values().map(({ size = measure() }) => size).toArray();
		`,
	}),
	// An eager \`map\` infers its result from the target type; after
	// \`.toArray()\` the helper \`map\` cannot, so the tuple widens to an array.
	suggestionCase({
		code: unindent`
			declare const map: Map<string, number>;

			export const pairs: Array<[string, number]> = [...map].map(([key, value]) => [key, value * 2]);
		`,
		suggestion: unindent`
			declare const map: Map<string, number>;

			export const pairs: Array<[string, number]> = map.entries().map(([key, value]) => [key, value * 2]).toArray();
		`,
	}),
	suggestionCase({
		code: unindent`
			declare const map: Map<string, number>;

			export function double(): Array<[string, number]> {
				return [...map].map(([key, value]) => [key, value * 2]);
			}
		`,
		suggestion: unindent`
			declare const map: Map<string, number>;

			export function double(): Array<[string, number]> {
				return map.entries().map(([key, value]) => [key, value * 2]).toArray();
			}
		`,
	}),
	// An iterable that would start a declaration at the start of a statement
	// gets parentheses.
	suggestionCase({
		code: unindent`
			[...function* () {
				yield 1;
			}()].map((n) => n * 2);
		`,
		suggestion: unindent`
			(function* () {
				yield 1;
			}()).map((n) => n * 2).toArray();
		`,
	}),
	// --- Report only: no equivalent iterator form ---
	// Iterator helpers take no `thisArg`.
	suggestionCase({
		code: unindent`
			declare const set: Set<number>;
			declare const limits: { min: number };

			export const above = [...set].filter(function (this: { min: number }, n) {
				return n > this.min;
			}, limits);
		`,
		suggestion: null,
	}),
	// A helper callback gets no third argument.
	suggestionCase({
		code: unindent`
			declare const set: Set<number>;

			export const sizes = [...set].map((n, index, all) => all.length);
		`,
		suggestion: null,
	}),
	suggestionCase({
		code: unindent`
			declare const set: Set<number>;

			export const sizes = [...set].map((...parameters) => parameters.length);
		`,
		suggestion: null,
	}),
	suggestionCase({
		code: unindent`
			declare const set: Set<number>;

			export const sizes = [...set].map(function () {
				return arguments.length;
			});
		`,
		suggestion: null,
	}),
	suggestionCase({
		code: unindent`
			declare const set: Set<number>;

			export const doubled = [...set].filter((n) => n > 0)?.map((n) => n * 2);
		`,
		suggestion: null,
	}),
	// A comment in the removed text would be lost.
	suggestionCase({
		code: unindent`
			declare const set: Set<number>;

			export const doubled = [/* snapshot */ ...set].map((n) => n * 2);
		`,
		suggestion: null,
	}),
	suggestionCase({
		code: unindent`
			declare const set: Set<number>;

			export const doubled = Array.from(set /* snapshot */).map((n) => n * 2);
		`,
		suggestion: null,
	}),
	// A comment inside the iterable is kept.
	{
		code: unindent`
			declare const map: Map<string, number>;

			export const doubled = [...map./* live */keys()].map((key) => key);
		`,
		errors: [{ messageId }],
		output: unindent`
			declare const map: Map<string, number>;

			export const doubled = map./* live */keys().map((key) => key).toArray();
		`,
	},
	// A leading \`(\` after an expression on the line before would join the
	// lines.
	suggestionCase({
		code: unindent`
			declare const first: Set<number> | undefined;
			declare const second: Set<number>;
			let count = 1
			Array.from(first ?? second).map((n) => n + count);
		`,
		suggestion: null,
	}),
	{
		code: unindent`
			declare const first: Set<number> | undefined;
			declare const second: Set<number>;
			let count = 1;
			Array.from(first ?? second).map((n) => n + count);
		`,
		errors: [{ messageId }],
		output: unindent`
			declare const first: Set<number> | undefined;
			declare const second: Set<number>;
			let count = 1;
			(first ?? second).values().map((n) => n + count).toArray();
		`,
	},
	// A non-null assertion also ends an expression.
	suggestionCase({
		code: unindent`
			declare const first: Set<number> | undefined;
			declare const second: Set<number>;
			declare const run: (() => void) | undefined;
			const task = run!
			Array.from(first ?? second).map((n) => n + 1);
		`,
		suggestion: null,
	}),
	// So does a private name.
	suggestionCase({
		code: unindent`
			declare const first: Set<number> | undefined;
			declare const second: Set<number>;

			export class Counter {
				#count = 0;

				read(): void {
					this.#count
					Array.from(first ?? second).map((n) => n + 1);
				}
			}
		`,
		suggestion: null,
	}),
	// The fix would drop the type arguments of \`Array.from\`.
	suggestionCase({
		code: unindent`
			declare const set: Set<number>;

			export const doubled = Array.from<number>(set).map((n) => n * 2);
		`,
		suggestion: null,
	}),
	// A local \`Iterator\` would take the place of the global.
	suggestionCase({
		code: unindent`
			declare const maybeSet: Set<number> | undefined;
			const Iterator = { from: <T>(value: Iterable<T>) => value };

			export const doubled = [...(maybeSet ?? [])].map((n) => n * 2);
		`,
		suggestion: null,
	}),

	// --- Targets without iterator helpers ---
	{
		code: unindent`
			declare const set: Set<number>;

			export const doubled = [...set].filter((n) => n > 0).map((n) => n * 2);
		`,
		errors: [
			{
				data: { chain: ".filter().map()", copy: "[...]" },
				messageId: noHelpersMessageId,
			},
		],
		options: [{ iteratorHelpers: false }],
		output: null,
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: noMaterializedFilterMap,
	valid,
});

/**
 * Type-checks fixed output against the fixture compiler options, which include
 * the `esnext` iterator helper declarations.
 *
 * @param files - Source text keyed by a file name unique to this program.
 * @returns The diagnostic messages for those files.
 */
function getTypeErrors(files: Record<string, string>): Array<string> {
	const directory = path.resolve(__dirname, "../../../fixtures");
	const parsed = ts.getParsedCommandLineOfConfigFile(
		path.join(directory, "tsconfig.json"),
		{},
		{ ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
	);
	const options = parsed?.options ?? {};
	const sources = new Map(
		Object.entries(files).map(([name, text]) => [path.join(directory, name), text]),
	);
	const host = ts.createCompilerHost(options);
	const readSourceFile = host.getSourceFile.bind(host);
	host.getSourceFile = (fileName, languageVersion, ...rest) => {
		const text = sources.get(path.normalize(fileName));
		return text === undefined
			? readSourceFile(fileName, languageVersion, ...rest)
			: ts.createSourceFile(fileName, text, languageVersion);
	};

	const program = ts.createProgram([...sources.keys()], options, host);
	return [...sources.keys()].flatMap((fileName) => {
		return ts
			.getPreEmitDiagnostics(program, program.getSourceFile(fileName))
			.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
	});
}

describe("fixed output", () => {
	it("passes the counter a map callback would get as its index", () => {
		expect.assertions(1);

		const map = new Map([
			["", 2],
			["a", 1],
			["b", 3],
		]);
		const eager = [...map.keys()]
			.filter((name) => name !== "")
			.map((name, index) => `${index}:${name}`);
		const lazy = map
			.keys()
			.filter((name) => name !== "")
			.map((name, index) => `${index}:${name}`)
			.toArray();

		expect(lazy).toStrictEqual(eager);
	});

	it("type-checks, keeping type-guard narrowing", () => {
		expect.assertions(1);

		const errors = getTypeErrors({
			"materialized-guard.ts": unindent`
				declare const set: Set<string | undefined>;

				export const defined: Array<string> = set.values().filter((v): v is string => v !== undefined).toArray();
			`,
			"materialized-index.ts": unindent`
				declare const map: Map<string, number>;

				const names = map.keys()
					.filter((name) => name !== "")
					.map((name, index) => \`\${index}:\${name}\`).toArray();

				export const all: Array<string> = [...names, "end"];
			`,
			"materialized-map.ts": unindent`
				declare const maybeMap: Map<string, number> | undefined;

				export const positive: Map<string, number> = new Map(
					Iterator.from(maybeMap ?? []).filter(([, value]) => value > 0).map(([key, value]) => [key, value * 2]),
				);
			`,
			"materialized-nodes.ts": unindent`
				interface Graph {
					readonly nodes: Map<string, { readonly weight: number }>;
				}
				declare const graph: Graph;

				export const heavy: Map<string, number> = new Map(graph.nodes.entries().filter(([, node]) => node.weight > 1).map(([id, node]) => [id, node.weight]));
			`,
		});

		expect(errors).toStrictEqual([]);
	});
});
