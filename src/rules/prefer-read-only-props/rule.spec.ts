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
		filename,
		code: tsx`
			interface Props {
				readonly name: string;
			}
			function App(props: Props) {
				return <div>{props.name}</div>;
			}
		`,
	},
	// Props wrapped in Readonly<>.
	{
		filename,
		code: tsx`
			interface Props {
				name: string;
			}
			function App(props: Readonly<Props>) {
				return <div>{props.name}</div>;
			}
		`,
	},
	// Inline read-only type literal.
	{
		filename,
		code: "const App = (props: { readonly name: string }) => <div>{props.name}</div>;",
	},
	// Component with no parameters.
	{
		filename,
		code: "const App = () => <div />;",
	},
	// Only React built-in props (children/key/ref are treated as read-only).
	{
		filename,
		code: "const App = (props: { children: unknown }) => <div>{props.children}</div>;",
	},
	// Empty props object.
	{
		filename,
		code: "const App = (props: {}) => <div />;",
	},
	// Props already wrapped in the configured deep-readonly wrapper. Verifies
	// the alias short-circuit recognizes a mapped/conditional `Immutable<T>`.
	{
		filename,
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
		options: [{ wrapperType: "Immutable" }],
	},
	// Not a component (lower-case name, no JSX) — must be ignored.
	{
		filename,
		code: tsx`
			function helper(props: { name: string }) {
				return props.name;
			}
		`,
	},
];

const invalid: Array<InvalidTestCase> = [
	// Inline type literal on a function declaration.
	{
		filename,
		code: tsx`
			function App(props: { name: string }) {
				return <div>{props.name}</div>;
			}
		`,
		output: tsx`
			function App(props: Readonly<{ name: string }>) {
				return <div>{props.name}</div>;
			}
		`,
		errors: [{ messageId }],
	},
	// Named props interface on an arrow component.
	{
		filename,
		code: tsx`
			interface Props {
				name: string;
			}
			const App = (props: Props) => <div>{props.name}</div>;
		`,
		output: tsx`
			interface Props {
				name: string;
			}
			const App = (props: Readonly<Props>) => <div>{props.name}</div>;
		`,
		errors: [{ messageId }],
	},
	// Partially read-only props still get wrapped.
	{
		filename,
		code: tsx`
			interface Props {
				readonly a: number;
				b: string;
			}
			function App(props: Props) {
				return <div>{props.b}</div>;
			}
		`,
		output: tsx`
			interface Props {
				readonly a: number;
				b: string;
			}
			function App(props: Readonly<Props>) {
				return <div>{props.b}</div>;
			}
		`,
		errors: [{ messageId }],
	},
	// FC-style annotation: wrap the type argument.
	{
		filename,
		code: tsx`
			type FC<P> = (props: P) => any;
			interface Props {
				name: string;
			}
			const App: FC<Props> = (props) => <div>{props.name}</div>;
		`,
		output: tsx`
			type FC<P> = (props: P) => any;
			interface Props {
				name: string;
			}
			const App: FC<Readonly<Props>> = (props) => <div>{props.name}</div>;
		`,
		errors: [{ messageId }],
	},
	// forwardRef: wrap the props (second) type argument.
	{
		filename,
		code: tsx`
			declare function forwardRef<T, P>(render: (props: P, ref: T) => any): (props: P) => any;
			interface Props {
				name: string;
			}
			const App = forwardRef<HTMLDivElement, Props>((props, ref) => <div>{props.name}</div>);
		`,
		output: tsx`
			declare function forwardRef<T, P>(render: (props: P, ref: T) => any): (props: P) => any;
			interface Props {
				name: string;
			}
			const App = forwardRef<HTMLDivElement, Readonly<Props>>((props, ref) => <div>{props.name}</div>);
		`,
		errors: [{ messageId }],
	},
	// memo: wrap the props (first) type argument.
	{
		filename,
		code: tsx`
			declare function memo<P>(component: (props: P) => any): (props: P) => any;
			interface Props {
				name: string;
			}
			const App = memo<Props>((props) => <div>{props.name}</div>);
		`,
		output: tsx`
			declare function memo<P>(component: (props: P) => any): (props: P) => any;
			interface Props {
				name: string;
			}
			const App = memo<Readonly<Props>>((props) => <div>{props.name}</div>);
		`,
		errors: [{ messageId }],
	},
	// Custom wrapper with an import source: wrap and insert the type import.
	{
		filename,
		code: tsx`
			interface Props {
				name: string;
			}
			const App = (props: Props) => <div>{props.name}</div>;
		`,
		output: tsx`
			import type { Immutable } from "~/types";
			interface Props {
				name: string;
			}
			const App = (props: Immutable<Props>) => <div>{props.name}</div>;
		`,
		options: [{ importSource: "~/types", wrapperType: "Immutable" }],
		errors: [{ messageId }],
	},
	// Custom wrapper merges into an existing named import from the same module.
	{
		filename,
		code: tsx`
			import { type Foo } from "~/types";
			interface Props {
				name: string;
			}
			const App = (props: Props) => <div>{props.name}</div>;
		`,
		output: tsx`
			import { type Foo, type Immutable } from "~/types";
			interface Props {
				name: string;
			}
			const App = (props: Immutable<Props>) => <div>{props.name}</div>;
		`,
		options: [{ importSource: "~/types", wrapperType: "Immutable" }],
		errors: [{ messageId }],
	},
	// modifier mode: inline literal gets a per-property readonly modifier.
	{
		filename,
		code: tsx`
			function App(props: { name: string }) {
				return <div>{props.name}</div>;
			}
		`,
		output: tsx`
			function App(props: { readonly name: string }) {
				return <div>{props.name}</div>;
			}
		`,
		options: [{ fixStyle: "modifier" }],
		errors: [{ messageId }],
	},
	// modifier mode: a same-file named interface is modified in place.
	{
		filename,
		code: tsx`
			interface Props {
				name: string;
			}
			const App = (props: Props) => <div>{props.name}</div>;
		`,
		output: tsx`
			interface Props {
				readonly name: string;
			}
			const App = (props: Props) => <div>{props.name}</div>;
		`,
		options: [{ fixStyle: "modifier" }],
		errors: [{ messageId }],
	},
	// modifier mode: a same-file type alias to a type literal.
	{
		filename,
		code: tsx`
			type Props = {
				name: string;
			};
			const App = (props: Props) => <div>{props.name}</div>;
		`,
		output: tsx`
			type Props = {
				readonly name: string;
			};
			const App = (props: Props) => <div>{props.name}</div>;
		`,
		options: [{ fixStyle: "modifier" }],
		errors: [{ messageId }],
	},
	// modifier mode: only the mutable member of a partially read-only interface.
	{
		filename,
		code: tsx`
			interface Props {
				readonly a: number;
				b: string;
			}
			function App(props: Props) {
				return <div>{props.b}</div>;
			}
		`,
		output: tsx`
			interface Props {
				readonly a: number;
				readonly b: string;
			}
			function App(props: Props) {
				return <div>{props.b}</div>;
			}
		`,
		options: [{ fixStyle: "modifier" }],
		errors: [{ messageId }],
	},
	// modifier mode: a mutable index signature gets a readonly modifier.
	{
		filename,
		code: "const App = (props: { [key: string]: number }) => <div>{props.x}</div>;",
		output: "const App = (props: { readonly [key: string]: number }) => <div>{props.x}</div>;",
		options: [{ fixStyle: "modifier" }],
		errors: [{ messageId }],
	},
	// modifier mode: an FC annotation reaches the referenced same-file interface
	// rather than the type argument.
	{
		filename,
		code: tsx`
			type FC<P> = (props: P) => any;
			interface Props {
				name: string;
			}
			const App: FC<Props> = (props) => <div>{props.name}</div>;
		`,
		output: tsx`
			type FC<P> = (props: P) => any;
			interface Props {
				readonly name: string;
			}
			const App: FC<Props> = (props) => <div>{props.name}</div>;
		`,
		options: [{ fixStyle: "modifier" }],
		errors: [{ messageId }],
	},
	// modifier mode: forwardRef likewise reaches the same-file interface.
	{
		filename,
		code: tsx`
			declare function forwardRef<T, P>(render: (props: P, ref: T) => any): (props: P) => any;
			interface Props {
				name: string;
			}
			const App = forwardRef<HTMLDivElement, Props>((props, ref) => <div>{props.name}</div>);
		`,
		output: tsx`
			declare function forwardRef<T, P>(render: (props: P, ref: T) => any): (props: P) => any;
			interface Props {
				readonly name: string;
			}
			const App = forwardRef<HTMLDivElement, Props>((props, ref) => <div>{props.name}</div>);
		`,
		options: [{ fixStyle: "modifier" }],
		errors: [{ messageId }],
	},
	// modifier mode: a union props type is not attributable to a single
	// declaration, so it is reported without a fix.
	{
		filename,
		code: tsx`
			interface A {
				a: number;
			}
			interface B {
				b: number;
			}
			type Props = A | B;
			function App(props: Props) {
				return <div />;
			}
		`,
		output: null,
		options: [{ fixStyle: "modifier" }],
		errors: [{ messageId }],
	},
	// modifier mode: a method signature cannot take a readonly modifier, so the
	// component is reported without a fix even though `name` alone could be
	// fixed.
	{
		filename,
		code: tsx`
			interface Props {
				name: string;
				onClick(): void;
			}
			function App(props: Props) {
				return <div onClick={props.onClick}>{props.name}</div>;
			}
		`,
		output: null,
		options: [{ fixStyle: "modifier" }],
		errors: [{ messageId }],
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: preferReadOnlyProps,
	valid,
});
