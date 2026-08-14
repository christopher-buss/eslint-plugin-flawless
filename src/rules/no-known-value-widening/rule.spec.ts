import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { noKnownValueWidening, RULE_NAME } from "./rule";

const messageId = "widening";

const valid: Array<ValidTestCase> = [
	// Inference is preserved, so nothing is discarded.
	unindent`
		const owner = { id: "1", name: "root" };
	`,
	// `satisfies` checks against the contract without widening the value.
	unindent`
		interface Owner { id: string }
		const owner = { id: "1" } satisfies Owner;
	`,
	// A named interface is the owner contract, not a widening target.
	unindent`
		interface Owner { id: string }
		const owner: Owner = { id: "1" };
	`,
	// A non-generic alias to a real shape is equally a named contract.
	unindent`
		type Owner = { id: string };
		const owner: Owner = { id: "1" };
	`,
	// An empty literal seeding a dictionary needs its annotation.
	unindent`
		const counts: Record<string, number> = {};
	`,
	unindent`
		const counts: { [key: string]: number } = {};
	`,
	// The value is external, so there is no syntactic evidence to discard.
	unindent`
		declare function load(): unknown;
		const payload: unknown = load();
	`,
	unindent`
		declare const raw: string;
		const parsed: Record<string, unknown> = JSON.parse(raw);
	`,
	// A `let` rebound elsewhere no longer carries its initializer's evidence.
	unindent`
		let owner = { id: "1" };
		owner = loadOwner();
		const widened: unknown = owner;
	`,
	// A generic alias that resolves to a named shape, not a dictionary.
	unindent`
		interface Owner { id: string }
		type Boxed<Value> = { readonly value: Value };
		const owner: Boxed<Owner> = { value: { id: "1" } };
	`,
	// An empty literal seeding a generic dictionary is still an accumulator.
	unindent`
		type Registry<Value> = Record<string, Value>;
		const registry: Registry<number> = {};
	`,
	// Only the outermost assertion of a chain decides the final type.
	unindent`
		interface Owner { id: string }
		const owner = { id: "1" } as unknown as Owner;
	`,
	// An unannotated return keeps inference.
	unindent`
		function makeOwner() {
			return { id: "1" };
		}
	`,
	// A shadowed \`Record\` is not the built-in dictionary.
	unindent`
		type Record<Key, Value> = Map<Key, Value>;
		const owner: Record<string, unknown> = new Map();
	`,
];

const invalid: Array<InvalidTestCase> = [
	{
		code: unindent`
			const owner: unknown = { id: "1" };
		`,
		errors: [{ data: { subject: "binding \`owner\`", target: "unknown" }, messageId }],
	},
	{
		code: unindent`
			const owner: object = { id: "1" };
		`,
		errors: [{ data: { subject: "binding \`owner\`", target: "object" }, messageId }],
	},
	{
		code: unindent`
			const owner: Record<string, unknown> = { id: "1" };
		`,
		errors: [{ data: { subject: "binding \`owner\`", target: "open dictionary" }, messageId }],
	},
	{
		code: unindent`
			const owner: { [key: string]: string } = { id: "1" };
		`,
		errors: [{ data: { subject: "binding \`owner\`", target: "open dictionary" }, messageId }],
	},
	{
		// An inline type literal restates a shape the initializer establishes.
		code: unindent`
			const owner: { id: string } = { id: "1" };
		`,
		errors: [{ data: { subject: "binding \`owner\`", target: "anonymous object" }, messageId }],
	},
	{
		// The alias chain ends at a bare escape hatch, so the name adds nothing.
		code: unindent`
			type Payload = unknown;
			const owner: Payload = { id: "1" };
		`,
		errors: [{ data: { subject: "binding \`owner\`", target: "unknown" }, messageId }],
	},
	{
		// `Readonly` is transparent, so the wrapped target still decides.
		code: unindent`
			const owner: Readonly<Record<string, string>> = { id: "1" };
		`,
		errors: [{ data: { subject: "binding \`owner\`", target: "open dictionary" }, messageId }],
	},
	{
		// A non-empty literal is not an accumulator seed.
		code: unindent`
			const counts: Record<string, number> = { root: 1 };
		`,
		errors: [{ data: { subject: "binding \`counts\`", target: "open dictionary" }, messageId }],
	},
	{
		// A generic alias resolving to a dictionary is a generic container: the
		// value type is honest, but the key set is still unconstrained.
		code: unindent`
			interface Owner { id: string }
			type Registry<Value> = Record<string, Value>;
			const registry: Registry<Owner> = { root: { id: "1" } };
		`,
		errors: [
			{ data: { subject: "binding \`registry\`", target: "generic container" }, messageId },
		],
	},
	{
		// The evidence survives a stable `const` hop.
		code: unindent`
			const owner = { id: "1" };
			const widened: unknown = owner;
		`,
		errors: [{ data: { subject: "binding \`widened\`", target: "unknown" }, messageId }],
	},
	{
		code: unindent`
			const owner = { id: "1" } as unknown;
		`,
		errors: [{ data: { subject: "assertion", target: "unknown" }, messageId }],
	},
	{
		code: unindent`
			const owner = <Record<string, unknown>>{ id: "1" };
		`,
		errors: [{ data: { subject: "assertion", target: "open dictionary" }, messageId }],
	},
	{
		code: unindent`
			function makeOwner(): unknown {
				return { id: "1" };
			}
		`,
		errors: [
			{ data: { subject: "return value of \`makeOwner\`", target: "unknown" }, messageId },
		],
	},
	{
		code: unindent`
			const makeOwner = (): object => ({ id: "1" });
		`,
		errors: [
			{ data: { subject: "return value of \`makeOwner\`", target: "object" }, messageId },
		],
	},
	{
		code: unindent`
			export default function (): unknown {
				return [1, 2, 3];
			}
		`,
		errors: [
			{
				data: { subject: "return value of \`anonymous function\`", target: "unknown" },
				messageId,
			},
		],
	},
	{
		code: unindent`
			class Owners {
				private readonly cache: Record<string, unknown> = { root: 1 };
			}
		`,
		errors: [{ data: { subject: "property \`cache\`", target: "open dictionary" }, messageId }],
	},
	{
		code: unindent`
			class Owners {
				make(): unknown {
					return { id: "1" };
				}
			}
		`,
		errors: [{ data: { subject: "return value of \`make\`", target: "unknown" }, messageId }],
	},
	{
		// A `let` that is only ever initialized keeps its annotation's blame.
		code: unindent`
			let owner: unknown;
			owner = { id: "1" };
		`,
		errors: [{ data: { subject: "binding \`owner\`", target: "unknown" }, messageId }],
	},
	{
		code: unindent`
			const values: Array<unknown> = [1, 2, 3];
			const widened: unknown = values;
		`,
		errors: [{ data: { subject: "binding \`widened\`", target: "unknown" }, messageId }],
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: noKnownValueWidening,
	valid,
});
