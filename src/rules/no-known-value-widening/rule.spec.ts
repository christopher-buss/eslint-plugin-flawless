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
	// An empty literal seeding a dictionary needs its annotation, wherever the
	// seed appears.
	unindent`
		const counts: Record<string, number> = {};
	`,
	unindent`
		const counts: { [key: string]: number } = {};
	`,
	unindent`
		class Counters {
			counts: Record<string, number> = {};
		}
	`,
	unindent`
		function makeCounts(): Record<string, number> {
			return {};
		}
	`,
	unindent`
		const makeCounts = (): Record<string, number> => ({});
	`,
	unindent`
		const counts = {} as Record<string, number>;
	`,
	unindent`
		let counts: Record<string, number>;
		counts = {};
	`,
	// A mapped type keyed by a named union states which properties exist, so an
	// alias to it is a contract even though a direct mapped type is not.
	unindent`
		type Level = "admin" | "guest";
		type Levels = { readonly [Key in Level]: number };
		const levels: Levels = { admin: 1, guest: 0 };
	`,
	// A `Record` keyed by a finite union states exactly which keys exist.
	unindent`
		type Diet = "omnivore" | "vegan";
		const labels: Record<Diet, string> = { omnivore: "O", vegan: "V" };
	`,
	unindent`
		const labels: Record<"a" | "b", number> = { a: 1, b: 2 };
	`,
	unindent`
		type Diet = "omnivore" | "vegan";
		type Labels = Readonly<Record<Diet, string>>;
		const labels: Labels = { omnivore: "O", vegan: "V" };
	`,
	// A generic alias applied to a finite key is not a container.
	unindent`
		type Index<Key extends PropertyKey, Value> = Record<Key, Value>;
		const labels: Index<"root", number> = { root: 1 };
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
	// A nearer declaration shadows a module alias.
	unindent`
		type Owner = unknown;
		function make() {
			interface Owner { id: string }
			const owner: Owner = { id: "1" };
			return owner;
		}
	`,
	// A type parameter shadows a module alias of the same name.
	unindent`
		type Payload = unknown;
		function wrap<Payload>(make: () => Payload): Payload {
			const value = { id: "1" } as Payload;
			return value;
		}
	`,
	// A block-scoped \`Record\` is not the built-in dictionary.
	unindent`
		function make() {
			type Record<Key, Value> = Map<Key, Value>;
			const owner: Record<string, unknown> = new Map();
			return owner;
		}
	`,
	// An unknown value entering a type predicate is exactly what it is for.
	unindent`
		function isString(value: unknown): value is string {
			return typeof value === "string";
		}
		declare const input: unknown;
		isString(input);
	`,
	unindent`
		function isString(value: unknown): value is string {
			return typeof value === "string";
		}
		declare function readInput(): unknown;
		isString(readInput());
	`,
	// A predicate over a known parameter type widens nothing.
	unindent`
		function isAdmin(value: string): value is "admin" {
			return value === "admin";
		}
		isAdmin("guest");
	`,
	// Only the predicate's subject parameter is checked.
	unindent`
		function isKey(target: object, key: unknown): target is Record<string, number> {
			return key !== undefined;
		}
		declare const target: object;
		isKey(target, "root");
	`,
	// An annotated binding already fixed its type, so its initializer's
	// evidence does not reach later flows.
	unindent`
		function randomModuleSources(): Record<string, string> {
			const sources: Record<string, string> = {};
			sources.root = "1";
			return sources;
		}
	`,
	unindent`
		interface Owner { id: string }
		const owner: Owner = { id: "1" };
		function makeOwner(): { id: string } {
			return owner;
		}
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
		// An alias naming a dictionary is still a dictionary: the key set stays
		// open, so the name adds no constraint.
		code: unindent`
			type Registry = Record<string, number>;
			const registry: Registry = { root: 1 };
		`,
		errors: [
			{ data: { subject: "binding \`registry\`", target: "open dictionary" }, messageId },
		],
	},
	{
		code: unindent`
			type Registry = { [key: string]: number };
			const registry: Registry = { root: 1 };
		`,
		errors: [
			{ data: { subject: "binding \`registry\`", target: "open dictionary" }, messageId },
		],
	},
	{
		code: unindent`
			type Registry = { [Key in string]: number };
			const registry: Registry = { root: 1 };
		`,
		errors: [
			{ data: { subject: "binding \`registry\`", target: "open dictionary" }, messageId },
		],
	},
	{
		code: unindent`
			type Registry = { [Key in PropertyKey]: number };
			const registry: Registry = { root: 1 };
		`,
		errors: [
			{ data: { subject: "binding \`registry\`", target: "open dictionary" }, messageId },
		],
	},
	{
		code: unindent`
			type Registry = Readonly<Record<string, number>>;
			const registry: Registry = { root: 1 };
		`,
		errors: [
			{ data: { subject: "binding \`registry\`", target: "open dictionary" }, messageId },
		],
	},
	{
		// An alias to an applied generic alias resolves through both hops.
		code: unindent`
			type Index<Value> = Record<string, Value>;
			type Registry = Index<number>;
			const registry: Registry = { root: 1 };
		`,
		errors: [
			{ data: { subject: "binding \`registry\`", target: "open dictionary" }, messageId },
		],
	},
	{
		// A block-scoped alias resolves like a module one.
		code: unindent`
			function make() {
				type Registry = Record<string, number>;
				const registry: Registry = { root: 1 };
				return registry;
			}
		`,
		errors: [
			{ data: { subject: "binding \`registry\`", target: "open dictionary" }, messageId },
		],
	},
	{
		// A generic alias applied through its default is still a container.
		code: unindent`
			type Index<Value = number> = Record<string, Value>;
			const registry: Index = { root: 1 };
		`,
		errors: [
			{ data: { subject: "binding \`registry\`", target: "generic container" }, messageId },
		],
	},
	{
		// One broad member opens the whole key set.
		code: unindent`
			const counts: Record<"root" | string, number> = { root: 1 };
		`,
		errors: [{ data: { subject: "binding \`counts\`", target: "open dictionary" }, messageId }],
	},
	{
		// A key alias resolving to \`string\` is still broad.
		code: unindent`
			type Key = string;
			const counts: Record<Key, number> = { root: 1 };
		`,
		errors: [{ data: { subject: "binding \`counts\`", target: "open dictionary" }, messageId }],
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
	{
		// A known value is widened back to \`unknown\` by a local type predicate.
		code: unindent`
			interface User { id: string }
			function isUser(value: unknown): value is User {
				return value !== null;
			}
			declare const user: User;
			isUser(user);
		`,
		errors: [
			{
				data: {
					subject: "argument for parameter \`value\` of \`isUser\`",
					target: "unknown",
				},
				messageId,
			},
		],
	},
	{
		code: unindent`
			function isString(value: string | unknown): value is string {
				return typeof value === "string";
			}
			const known = "known";
			isString(known);
		`,
		errors: [
			{
				data: {
					subject: "argument for parameter \`value\` of \`isString\`",
					target: "unknown",
				},
				messageId,
			},
		],
	},
	{
		code: unindent`
			const isString = (value: unknown): value is string => typeof value === "string";
			function check(known: string): boolean {
				return isString(known);
			}
		`,
		errors: [
			{
				data: {
					subject: "argument for parameter \`value\` of \`isString\`",
					target: "unknown",
				},
				messageId,
			},
		],
	},
	{
		// A local call with an informative return type is known evidence.
		code: unindent`
			interface User { id: string }
			function isUser(value: unknown): value is User {
				return value !== null;
			}
			function parse(): User {
				return { id: "1" };
			}
			isUser(parse());
		`,
		errors: [
			{
				data: {
					subject: "argument for parameter \`value\` of \`isUser\`",
					target: "unknown",
				},
				messageId,
			},
		],
	},
	{
		// An annotated binding's evidence is its declared type, which \`unknown\`
		// discards.
		code: unindent`
			interface Owner { id: string }
			const owner: Owner = { id: "1" };
			const widened: unknown = owner;
		`,
		errors: [{ data: { subject: "binding \`widened\`", target: "unknown" }, messageId }],
	},
	{
		// An unannotated \`const\` still carries its literal's evidence.
		code: unindent`
			function makeCounts(): Record<string, number> {
				const counts = { root: 1 };
				return counts;
			}
		`,
		errors: [
			{
				data: { subject: "return value of \`makeCounts\`", target: "open dictionary" },
				messageId,
			},
		],
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: noKnownValueWidening,
	valid,
});
