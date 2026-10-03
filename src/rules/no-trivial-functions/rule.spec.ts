import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { noTrivialFunctions, RULE_NAME } from "./rule";

const messageId = "trivial";

const valid: Array<ValidTestCase> = [
	// Exported directly, through a later specifier, or as the default export.
	unindent`
		export function getName(user) { return user.name }
		const parse = value => parseValue(value)
		const format = value => formatValue(value)
		export { parse }
		export default format
	`,
	"export const getName = (user) => user.name",
	"export default function getName(user) { return user.name }",
	// A renamed specifier still exposes the local name.
	"const parse = (value) => parseValue(value)\nexport { parse as read }",
	// Reaching the threshold earns the abstraction its name.
	{
		code: unindent`
			const getName = user => user.name
			getName(first)
			getName(second)
		`,
		options: [{ minimumReferences: 2 }],
	},
	unindent`
		const getName = user => user.name
		getName(a); getName(b); getName(c); getName(d); getName(e)
	`,
	// Assertions keep a reference a value reference.
	{
		code: unindent`
			const getName = user => user.name
			use(getName as unknown)
			use(getName!)
			use(<unknown>getName)
		`,
		options: [{ minimumReferences: 3 }],
	},
	// Transformations or added behaviour.
	unindent`
		const create = user => ({ name: user.name })
		const increment = value => value + 1
		const normalize = value => parseValue(value.trim())
		const choose = value => value ? first : second
		function validate(value) { if (!value) throw new Error(); return value }
	`,
	// Identity is not a member access.
	"const identity = (value) => value",
	// Nested functions are not top-level.
	"function outer() { const nested = value => parseValue(value); return nested }",
	// Async and generator functions add behaviour.
	"async function load(id) { return fetchItem(id) }",
	"const load = async (id) => fetchItem(id)",
	"function* items(list) { return list.items }",
	// Destructured, defaulted, and rest-in-access parameters.
	"const getName = ({ user }) => user.name",
	"const parse = (value = '') => parseValue(value)",
	"const first = (...values) => values.length",
	// Optional chaining and optional calls.
	"const getName = (user) => user?.name",
	"const getName = (user) => user.profile?.name",
	"const parse = (value) => parseValue?.(value)",
	// Argument order, arity, or form differs from the parameters.
	"const swap = (a, b) => combine(b, a)",
	"const partial = (a, b) => combine(a)",
	"const extra = (a) => combine(a, 1)",
	"const spreadPlain = (a) => combine(...a)",
	"const restPlain = (...a) => combine(a)",
	// Member root is not a parameter.
	"const read = (user) => config.name",
	// Block bodies with more than one statement or no value.
	"function read(user) { log(); return user.name }",
	"function nothing(user) { return }",
	// A function that is not function-valued, or a destructured declarator.
	"const { name } = user",
	"const value = user.name",
];

const invalid: Array<InvalidTestCase> = [
	// Property access and transparent forwarding, each referenced once.
	{
		code: unindent`
			function getName(user) { return user.profile.name }
			const parse = value => parseValue(value)
			getName(user)
			parse(input)
		`,
		errors: [
			{ data: { name: "getName", count: 1, minimum: 5 }, messageId },
			{ data: { name: "parse", count: 1, minimum: 5 }, messageId },
		],
	},
	// Type exports and re-exports do not expose the local value.
	{
		code: unindent`
			const parse = value => parseValue(value)
			const remote = value => remoteValue(value)
			export type { parse }
			export { remote } from "./remote"
		`,
		errors: [{ messageId }, { messageId }],
	},
	// The threshold is configurable.
	{
		code: unindent`
			const getName = user => user.name
			getName(first)
			getName(second)
		`,
		errors: [{ data: { name: "getName", count: 2, minimum: 3 }, messageId }],
		options: [{ minimumReferences: 3 }],
	},
	// Recursive and `typeof` references do not count.
	{
		code: unindent`
			const forward = value => forward(value)
			type Forward = typeof forward
			let other: typeof forward.length
		`,
		errors: [{ data: { name: "forward", count: 0, minimum: 5 }, messageId }],
	},
	// `as` and non-null expressions count as value references.
	{
		code: unindent`
			const getName = user => user.name
			use(getName as unknown)
			use(getName!)
		`,
		errors: [{ data: { name: "getName", count: 2, minimum: 5 }, messageId }],
	},
	// Rest parameters forwarded as a spread.
	{
		code: "const log = (message, ...rest) => console.log(message, ...rest)",
		errors: [{ messageId }],
	},
	// No parameters forwarding to a no-argument call.
	{
		code: "function now() { return Date.now() }",
		errors: [{ messageId }],
	},
	// Block body with a lone expression statement.
	{
		code: "function save(item) { store.save(item) }",
		errors: [{ messageId }],
	},
	// Function expression initializer, and a `var` declarator.
	{
		code: "var getName = function (user) { return user.name }",
		errors: [{ messageId }],
	},
	// Computed member access rooted at a parameter.
	{
		code: "const at = (list, index) => list[index]",
		errors: [{ messageId }],
	},
	// A shadowing inner binding is not a reference to the outer function.
	{
		code: unindent`
			const getName = user => user.name
			function other(getName) { return getName(1) + getName(2) + getName(3) + getName(4) + getName(5) }
			other(1)
		`,
		errors: [{ data: { name: "getName", count: 0, minimum: 5 }, messageId }],
	},
	// Each declarator of a multi-declarator statement is checked on its own.
	{
		code: "const a = (x) => x.a, b = (x) => x.b + 1",
		errors: [{ data: { name: "a", count: 0, minimum: 5 }, messageId }],
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: noTrivialFunctions,
	valid,
});
