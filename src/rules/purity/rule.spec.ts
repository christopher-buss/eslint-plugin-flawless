import {
	type InvalidTestCase,
	unindent as tsx,
	type ValidTestCase,
} from "eslint-vitest-rule-tester";

import { run } from "../test";
import { purity, RULE_NAME } from "./rule";

const messageId = "impureCall";
const filename = "file.tsx";

const valid: Array<ValidTestCase> = [
	// Impure call inside an event-handler closure, not during render.
	{
		filename,
		code: tsx`
			function Component() {
				const onClick = () => math.random();
				return <frame />;
			}
		`,
	},
	// Impure call inside a useEffect callback.
	{
		filename,
		code: tsx`
			function Component() {
				useEffect(() => {
					os.clock();
				}, []);
				return <frame />;
			}
		`,
	},
	// Impure call inside a useState lazy initializer.
	{
		filename,
		code: tsx`
			function Component() {
				const [value] = useState(() => math.random());
				return <frame />;
			}
		`,
	},
	// Impure call inside a useCallback body (not a useMemo).
	{
		filename,
		code: tsx`
			function Component() {
				const cb = useCallback(() => os.time(), []);
				return <frame />;
			}
		`,
	},
	// `new Random(seed)` with an explicit seed is deterministic.
	{
		filename,
		code: tsx`
			function Component() {
				const rng = new Random(12345);
				return <frame />;
			}
		`,
	},
	// Negative literal seed (a UnaryExpression, not a Literal).
	{
		filename,
		code: tsx`
			function Component() {
				const rng = new Random(-1);
				return <frame />;
			}
		`,
	},
	// A variable seed is also deterministic given that seed.
	{
		filename,
		code: tsx`
			function Component(props) {
				const rng = new Random(props.seed);
				return <frame />;
			}
		`,
	},
	// A render prop is called later, not during this component's render.
	{
		filename,
		code: tsx`
			function Component() {
				return <Child render={() => math.random()} />;
			}
		`,
	},
	// Plain, non-component/non-hook function is not render.
	{
		filename,
		code: tsx`
			function helper() {
				return math.random();
			}
		`,
	},
	// Shadowed global: local \`math\` is not the ambient Luau global.
	{
		filename,
		code: tsx`
			function Component() {
				const math = { random: () => 1 };
				const value = math.random();
				return <frame />;
			}
		`,
	},
	// Computed access is intentionally not matched.
	{
		filename,
		code: tsx`
			function Component() {
				const value = os["clock"]();
				return <frame />;
			}
		`,
	},
	// A default signature removed via \`ignore\`.
	{
		filename,
		code: tsx`
			function Component() {
				const value = os.date();
				return <frame />;
			}
		`,
		options: [{ ignore: ["os.date"] }],
	},
];

const invalid: Array<InvalidTestCase> = [
	// math.random directly in a component body.
	{
		filename,
		code: tsx`
			function Component() {
				const value = math.random();
				return <frame />;
			}
		`,
		errors: [
			{
				message:
					"Do not call 'math.random' during render. Components and hooks must be pure. Move this call into an event handler, effect, or state initializer.",
				messageId,
			},
		],
	},
	// os.time in a custom hook body.
	{
		filename,
		code: tsx`
			function useThing() {
				return os.time();
			}
		`,
		errors: [{ messageId }],
	},
	// Optional chaining on the callee still matches.
	{
		filename,
		code: tsx`
			function Component() {
				const value = os?.clock();
				return <frame />;
			}
		`,
		errors: [{ messageId }],
	},
	// new Random() in a useMemo callback.
	{
		filename,
		code: tsx`
			function Component() {
				const rng = useMemo(() => new Random(), []);
				return <frame />;
			}
		`,
		errors: [{ messageId }],
	},
	// DateTime.now in a component body.
	{
		filename,
		code: tsx`
			function Component() {
				const now = DateTime.now();
				return <frame />;
			}
		`,
		errors: [{ messageId }],
	},
	// Direct-global service method: HttpService.GenerateGUID.
	{
		filename,
		code: tsx`
			function Component() {
				const id = HttpService.GenerateGUID();
				return <frame />;
			}
		`,
		errors: [{ messageId }],
	},
	// Direct-global service method: Workspace.GetServerTimeNow.
	{
		filename,
		code: tsx`
			function Component() {
				const now = Workspace.GetServerTimeNow();
				return <frame />;
			}
		`,
		errors: [{ messageId }],
	},
	// User-supplied signature via \`additionalFunctions\` (Luau Math polyfill).
	{
		filename,
		code: tsx`
			function Component() {
				const value = Math.random();
				return <frame />;
			}
		`,
		options: [{ additionalFunctions: ["Math.random"] }],
		errors: [{ messageId }],
	},
];

run({
	name: RULE_NAME,
	invalid,
	parserOptions: {
		ecmaFeatures: { jsx: true },
		ecmaVersion: "latest",
		sourceType: "module",
	},
	rule: purity,
	valid,
});
