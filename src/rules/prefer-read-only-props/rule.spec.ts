import {
	type InvalidTestCase,
	unindent as tsx,
	type ValidTestCase,
} from "eslint-vitest-rule-tester";

import { run } from "../test";
import { preferReadOnlyProps, RULE_NAME } from "./rule";

const messageId = "preferReadOnlyProps";
const filename = "file.tsx";

const valid: Array<ValidTestCase> = [
	// Named props interface that is already read-only.
	{
		code: tsx`
			interface Props {
				readonly name: string;
			}
			function App(props: Props) {
				return <div>{props.name}</div>;
			}
		`,
		filename,
	},
	// Props wrapped in Readonly<>.
	{
		code: tsx`
			interface Props {
				name: string;
			}
			function App(props: Readonly<Props>) {
				return <div>{props.name}</div>;
			}
		`,
		filename,
	},
	// Inline read-only type literal.
	{
		code: "const App = (props: { readonly name: string }) => <div>{props.name}</div>;",
		filename,
	},
	// Component with no parameters.
	{
		code: "const App = () => <div />;",
		filename,
	},
	// Only React built-in props (children/key/ref are treated as read-only).
	{
		code: "const App = (props: { children: unknown }) => <div>{props.children}</div>;",
		filename,
	},
	// Empty props object.
	{
		code: "const App = (props: {}) => <div />;",
		filename,
	},
	// Props already wrapped in the configured deep-readonly wrapper. Verifies
	// the alias short-circuit recognizes a mapped/conditional `Immutable<T>`.
	{
		code: tsx`
			type ImmutablePrimitive = boolean | number | string | undefined;
			type Immutable<T> = T extends ImmutablePrimitive
				? T
				: { readonly [K in keyof T]: Immutable<T[K]> };
			interface Props {
				name: string;
			}
			const App = (props: Immutable<Props>) => <div>{props.name}</div>;
		`,
		filename,
		options: [{ wrapperType: "Immutable" }],
	},
	// Not a component (lower-case name, no JSX) — must be ignored.
	{
		code: tsx`
			function helper(props: { name: string }) {
				return props.name;
			}
		`,
		filename,
	},
];

const invalid: Array<InvalidTestCase> = [
	// Inline type literal on a function declaration.
	{
		code: tsx`
			function App(props: { name: string }) {
				return <div>{props.name}</div>;
			}
		`,
		errors: [{ messageId }],
		filename,
		output: tsx`
			function App(props: Readonly<{ name: string }>) {
				return <div>{props.name}</div>;
			}
		`,
	},
	// Named props interface on an arrow component.
	{
		code: tsx`
			interface Props {
				name: string;
			}
			const App = (props: Props) => <div>{props.name}</div>;
		`,
		errors: [{ messageId }],
		filename,
		output: tsx`
			interface Props {
				name: string;
			}
			const App = (props: Readonly<Props>) => <div>{props.name}</div>;
		`,
	},
	// Partially read-only props still get wrapped.
	{
		code: tsx`
			interface Props {
				readonly a: number;
				b: string;
			}
			function App(props: Props) {
				return <div>{props.b}</div>;
			}
		`,
		errors: [{ messageId }],
		filename,
		output: tsx`
			interface Props {
				readonly a: number;
				b: string;
			}
			function App(props: Readonly<Props>) {
				return <div>{props.b}</div>;
			}
		`,
	},
	// FC-style annotation: wrap the type argument.
	{
		code: tsx`
			type FC<P> = (props: P) => any;
			interface Props {
				name: string;
			}
			const App: FC<Props> = (props) => <div>{props.name}</div>;
		`,
		errors: [{ messageId }],
		filename,
		output: tsx`
			type FC<P> = (props: P) => any;
			interface Props {
				name: string;
			}
			const App: FC<Readonly<Props>> = (props) => <div>{props.name}</div>;
		`,
	},
	// forwardRef: wrap the props (second) type argument.
	{
		code: tsx`
			declare function forwardRef<T, P>(render: (props: P, ref: T) => any): (props: P) => any;
			interface Props {
				name: string;
			}
			const App = forwardRef<HTMLDivElement, Props>((props, ref) => <div>{props.name}</div>);
		`,
		errors: [{ messageId }],
		filename,
		output: tsx`
			declare function forwardRef<T, P>(render: (props: P, ref: T) => any): (props: P) => any;
			interface Props {
				name: string;
			}
			const App = forwardRef<HTMLDivElement, Readonly<Props>>((props, ref) => <div>{props.name}</div>);
		`,
	},
	// memo: wrap the props (first) type argument.
	{
		code: tsx`
			declare function memo<P>(component: (props: P) => any): (props: P) => any;
			interface Props {
				name: string;
			}
			const App = memo<Props>((props) => <div>{props.name}</div>);
		`,
		errors: [{ messageId }],
		filename,
		output: tsx`
			declare function memo<P>(component: (props: P) => any): (props: P) => any;
			interface Props {
				name: string;
			}
			const App = memo<Readonly<Props>>((props) => <div>{props.name}</div>);
		`,
	},
	// Custom wrapper with an import source: wrap and insert the type import.
	{
		code: tsx`
			interface Props {
				name: string;
			}
			const App = (props: Props) => <div>{props.name}</div>;
		`,
		errors: [{ messageId }],
		filename,
		options: [{ importSource: "~/types", wrapperType: "Immutable" }],
		output: tsx`
			import type { Immutable } from "~/types";
			interface Props {
				name: string;
			}
			const App = (props: Immutable<Props>) => <div>{props.name}</div>;
		`,
	},
	// Custom wrapper merges into an existing named import from the same module.
	{
		code: tsx`
			import { type Foo } from "~/types";
			interface Props {
				name: string;
			}
			const App = (props: Props) => <div>{props.name}</div>;
		`,
		errors: [{ messageId }],
		filename,
		options: [{ importSource: "~/types", wrapperType: "Immutable" }],
		output: tsx`
			import { type Foo, type Immutable } from "~/types";
			interface Props {
				name: string;
			}
			const App = (props: Immutable<Props>) => <div>{props.name}</div>;
		`,
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: preferReadOnlyProps,
	valid,
});
