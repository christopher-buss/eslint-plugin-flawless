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
		code: tsx`
			function Component() {
				const onClick = () => math.random();
				return <frame />;
			}
		`,
		filename,
	},
	// Impure call inside a useEffect callback.
	{
		code: tsx`
			function Component() {
				useEffect(() => {
					os.clock();
				}, []);
				return <frame />;
			}
		`,
		filename,
	},
	// Impure call inside a useState lazy initializer.
	{
		code: tsx`
			function Component() {
				const [value] = useState(() => math.random());
				return <frame />;
			}
		`,
		filename,
	},
	// Impure call inside a useCallback body (not a useMemo).
	{
		code: tsx`
			function Component() {
				const cb = useCallback(() => os.time(), []);
				return <frame />;
			}
		`,
		filename,
	},
	// `new Random(seed)` with an explicit seed is deterministic.
	{
		code: tsx`
			function Component() {
				const rng = new Random(12345);
				return <frame />;
			}
		`,
		filename,
	},
	// Negative literal seed (a UnaryExpression, not a Literal).
	{
		code: tsx`
			function Component() {
				const rng = new Random(-1);
				return <frame />;
			}
		`,
		filename,
	},
	// A variable seed is also deterministic given that seed.
	{
		code: tsx`
			function Component(props) {
				const rng = new Random(props.seed);
				return <frame />;
			}
		`,
		filename,
	},
	// A render prop is called later, not during this component's render.
	{
		code: tsx`
			function Component() {
				return <Child render={() => math.random()} />;
			}
		`,
		filename,
	},
	// Plain, non-component/non-hook function is not render.
	{
		code: tsx`
			function helper() {
				return math.random();
			}
		`,
		filename,
	},
	// Shadowed global: local \`math\` is not the ambient Luau global.
	{
		code: tsx`
			function Component() {
				const math = { random: () => 1 };
				const value = math.random();
				return <frame />;
			}
		`,
		filename,
	},
	// Computed access is intentionally not matched.
	{
		code: tsx`
			function Component() {
				const value = os["clock"]();
				return <frame />;
			}
		`,
		filename,
	},
	// A default signature removed via \`ignore\`.
	{
		code: tsx`
			function Component() {
				const value = os.date();
				return <frame />;
			}
		`,
		filename,
		options: [{ ignore: ["os.date"] }],
	},
];

const invalid: Array<InvalidTestCase> = [
	// math.random directly in a component body.
	{
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
		filename,
	},
	// os.time in a custom hook body.
	{
		code: tsx`
			function useThing() {
				return os.time();
			}
		`,
		errors: [{ messageId }],
		filename,
	},
	// Optional chaining on the callee still matches.
	{
		code: tsx`
			function Component() {
				const value = os?.clock();
				return <frame />;
			}
		`,
		errors: [{ messageId }],
		filename,
	},
	// new Random() in a useMemo callback.
	{
		code: tsx`
			function Component() {
				const rng = useMemo(() => new Random(), []);
				return <frame />;
			}
		`,
		errors: [{ messageId }],
		filename,
	},
	// DateTime.now in a component body.
	{
		code: tsx`
			function Component() {
				const now = DateTime.now();
				return <frame />;
			}
		`,
		errors: [{ messageId }],
		filename,
	},
	// Direct-global service method: HttpService.GenerateGUID.
	{
		code: tsx`
			function Component() {
				const id = HttpService.GenerateGUID();
				return <frame />;
			}
		`,
		errors: [{ messageId }],
		filename,
	},
	// Direct-global service method: Workspace.GetServerTimeNow.
	{
		code: tsx`
			function Component() {
				const now = Workspace.GetServerTimeNow();
				return <frame />;
			}
		`,
		errors: [{ messageId }],
		filename,
	},
	// User-supplied signature via \`additionalFunctions\` (Luau Math polyfill).
	{
		code: tsx`
			function Component() {
				const value = Math.random();
				return <frame />;
			}
		`,
		errors: [{ messageId }],
		filename,
		options: [{ additionalFunctions: ["Math.random"] }],
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
