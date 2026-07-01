import {
	type InvalidTestCase,
	unindent as tsx,
	type ValidTestCase,
} from "eslint-vitest-rule-tester";

import { run } from "../test";
import { preferDestructuringAssignment, RULE_NAME } from "./rule";

const messageId = "default";
const filename = "file.tsx";

const valid: Array<ValidTestCase> = [
	// A higher-order function whose returned arrow already uses destructuring.
	{
		code: tsx`
			export function hof(namespace) {
				const initialState = {
					bounds: null,
					search: false
				}
				return ({ x, y }) => {
					if (y) {
						return <span>{y}</span>;
					}
					return <span>{x}</span>
				}
			}
		`,
		filename,
	},
	// A reducer returned from a HOF is not a component.
	{
		code: tsx`
			export function hof(namespace) {
				const initialState = {
					bounds: null,
					search: false
				}
				return (state = initialState, action) => {
					if (action.type === 'ABC') {
						return {...state, bounds: stuff ? action.x : null}
					}
					if (action.namespace !== namespace) {
						return state
					}
					return null
				}
			}
		`,
		filename,
	},
	// Destructured parameter, arrow expression body.
	{
		code: "const App = ({ id, className }) => (<div id={id} className={className} />)",
		filename,
	},
	// Destructured parameter, block body.
	{
		code: tsx`
			const App = ({ id, className }) => {
				return <div id={id} className={className} />
			}
		`,
		filename,
	},
	// Destructuring the props parameter inside the body.
	{
		code: tsx`
			const App = (props) => {
				const { id, className } = props
				return <div id={id} className={className} />
			}
		`,
		filename,
	},
	// `props` passed on wholesale, never member-accessed.
	{ code: "const App = (props) => (<div id={id} props={props} />)", filename },
	{ code: "const Component = (props) => (<div id={id} props={props} />)", filename },
	{
		code: "const App = (props, { color }) => (<div id={id} props={props} color={color} />)",
		filename,
	},
	{
		code: "const Component = (props, { color }) => (<div id={id} props={props} color={color} />)",
		filename,
	},
	// A styled-components template is not a component.
	{
		code: tsx`
			const div = styled.div\`
			& .button {
				border-radius: \${props => props.borderRadius}px;
			}
			\`
		`,
		filename,
	},
	// A factory returning a plain object is not a component.
	{
		code: tsx`
			export default (context: $Context) => ({
				foo: context.bar
			})
		`,
		filename,
	},
	// `context` is a destructured binding, not the props parameter.
	{
		code: tsx`
			function App({ context }) {
				const d = context.describe()
				return <div>{d}</div>
			}
		`,
		filename,
	},
	// A method whose argument is member-accessed is not a component.
	{
		code: tsx`
			const obj = {
				foo(arg) {
					const a = arg.func()
					return null
				}
			}
		`,
		filename,
	},
	// Render callbacks inside a config array are not components.
	{
		code: tsx`
			const columns = [
				{
					render: (val) => {
						if (val.url) {
							return (
								<a href={val.url}>
								{val.test}
								</a>
								)
							}
							return null
						}
					}
				]
		`,
		filename,
	},
	{
		code: tsx`
			const columns = [
				{
					render: val => <span>{val}</span>
				},
				{
					someRenderFunc: function(val) {
						if (val.url) {
							return (
								<a href={val.url}>
								{val.test}
								</a>
								)
							}
							return null
						}
					}
				]
		`,
		filename,
	},
	{
		code: tsx`
			export default (fileName) => {
				const match = fileName.match(/some expression/)
				if (match) {
					return fn
				}
				return null
			}
		`,
		filename,
	},
	// Context destructured from `useContext`.
	{
		code: tsx`
			import { useContext } from 'react'
			const App = (props) => {
				const {foo} = useContext(aContext)
				return <div>{foo}</div>
			}
		`,
		filename,
	},
	{
		code: tsx`
			import { useContext } from 'react'
			const App = (props) => {
				const foo = useContext(aContext)
				return <div>{foo.test}</div>
			}
		`,
		filename,
	},
	// `forwardRef` / `memo` wrappers with a destructured parameter.
	{
		code: tsx`
			import { forwardRef } from "react";

			interface Props {
				day: string;
			}

			export const App = forwardRef<HTMLDivElement, Props>(
				function App({ day }, ref) {
					return <div ref={ref}>{day}</div>;
				}
			);
		`,
		filename,
	},
	{
		code: tsx`
			import { memo } from "react";

			interface Props {
				day: string;
			}

			export const App = memo(
				function App({ day }) {
					return <div ref={ref}>{day}</div>;
				}
			);
		`,
		filename,
	},
	{
		code: tsx`
			import { memo, forwardRef } from "react";

			interface Props {
				day: string;
			}

			export const App = memo(
				forwardRef<HTMLDivElement, Props>(
					function App({ day }, ref) {
						const onClick = () => { console.log(ref.current) };
						return <div ref={ref}>{day}</div>;
					}
				)
			);
		`,
		filename,
	},
	// https://github.com/Rel1cx/eslint-react/issues/1416
	{
		code: tsx`
			type DeliveryNoteCheck = (data: { supplierCompany: string | null }) => string | null;

			const deliveryNoteChecks: DeliveryNoteCheck[] = [
				(data) => {
					if (!data.supplierCompany) return null;
					return "Check for supplier company passed.";
				},
			];
		`,
		filename,
	},
	// Destructured parameters with member access on the destructured bindings.
	{
		code: tsx`
			const App = ({ title, description, meta }) => {
				return (
					<div>
						<h1>{title}</h1>
						<p>{description}</p>
						<span>{meta.tags.join(', ')}</span>
					</div>
				)
			}
		`,
		filename,
	},
	{
		code: tsx`
			const UserProfile = ({ user }) => {
				const { avatar, name, bio } = user
				return (
					<div>
						<img src={avatar} alt={name} />
						<h2>{name}</h2>
						<p>{bio}</p>
					</div>
				)
			}
		`,
		filename,
	},
	{
		code: tsx`
			const Component = ({ data = {} }) => {
				const { user = {} } = data
				return (
					<div>
						<span>{user.name}</span>
						<span>{user.email}</span>
					</div>
				)
			}
		`,
		filename,
	},
	{
		code: tsx`
			const List = ({ items }) => {
				return (
					<ul>
						{items.map(({ id, name }) => (
							<li key={id}>{name}</li>
						))}
					</ul>
				)
			}
		`,
		filename,
	},
	// Destructuring the props parameter inside the body (various shapes).
	{
		code: tsx`
			const Modal = (props) => {
				const { isOpen, onClose, children } = props
				if (!isOpen) return null
				return (
					<div className="modal">
						<button onClick={onClose}>Close</button>
						{children}
					</div>
				)
			}
		`,
		filename,
	},
	{
		code: tsx`
			const Component = (props) => {
				const { className, ...restProps } = props
				return <div className={className} {...restProps} />
			}
		`,
		filename,
	},
	{
		code: tsx`
			const Component = ({ data: { user, settings } }) => {
				return (
					<div>
						<span>{user.name}</span>
						<span>{settings.theme}</span>
					</div>
				)
			}
		`,
		filename,
	},
	{
		code: tsx`
			const Component = ({ isLoading, data }) => {
				if (isLoading) return <div>Loading...</div>
				return <div>{data.result}</div>
			}
		`,
		filename,
	},
	{
		code: tsx`
			const Component = (props) => {
				const { type } = props
				if (type === 'admin') {
					const { adminOnlyProp } = props
					return <div>Admin: {adminOnlyProp}</div>
				}
				return <div>Regular user</div>
			}
		`,
		filename,
	},
	{
		code: tsx`
			const Component = (props, context) => {
				const { theme } = context
				const { title, content } = props
				return (
					<div className={theme}>
						<h1>{title}</h1>
						<p>{content}</p>
					</div>
				)
			}
		`,
		filename,
	},
	// https://github.com/Rel1cx/eslint-react/issues/1488 — array-method callbacks
	// are not components.
	{
		code: tsx`
			const items = [{ property: "value" }];

			items.flatMap((item) => {
				console.log(item.property);
				return null;
			});

			items.filter((item) => {
				console.log(item.property);
				return null;
			});

			items.find((item) => {
				console.log(item.property);
				return null;
			});

			items.map((item) => {
				console.log(item.property);
				return null;
			});
		`,
		filename,
	},
];

const invalid: Array<InvalidTestCase> = [
	// Member access alongside an unrelated destructuring: fixable.
	{
		code: tsx`
			const App = (props) => {
				const { h, i } = hi
				return <div id={props.id} className={props.className} />
			}
		`,
		errors: [{ messageId }, { messageId }],
		filename,
		output: tsx`
			const App = ({ id, className }) => {
				const { h, i } = hi
				return <div id={id} className={className} />
			}
		`,
	},
	// `props` is also destructured wholesale: report only, no fix.
	{
		code: tsx`
			const App = (props) => {
				const { h, i } = props
				return <div id={props.id} className={props.className} />
			}
		`,
		errors: [{ messageId }, { messageId }],
		filename,
		output: null,
	},
	// A plain function component: fixable.
	{
		code: tsx`
			function App(props) {
				return <div id={props.id} className={props.className} />
			}
		`,
		errors: [{ messageId }, { messageId }],
		filename,
		output: tsx`
			function App({ id, className }) {
				return <div id={id} className={className} />
			}
		`,
	},
	// `forwardRef` wrapper: fixable.
	{
		code: tsx`
			import { forwardRef } from "react";

			interface Props {
				day: string;
			}

			export const App = forwardRef<HTMLDivElement, Props>(
				function App(props, ref) {
					return <div ref={ref}>{props.day}</div>;
				}
			);
		`,
		errors: [{ messageId }],
		filename,
		output: tsx`
			import { forwardRef } from "react";

			interface Props {
				day: string;
			}

			export const App = forwardRef<HTMLDivElement, Props>(
				function App({ day }, ref) {
					return <div ref={ref}>{day}</div>;
				}
			);
		`,
	},
	// `memo` wrapper with a typed parameter: fixable, type annotation preserved.
	{
		code: tsx`
			import { memo } from "react";

			interface Props {
				day: string;
			}

			export const App = memo(
				function App(props: Props) {
					return <div ref={ref}>{props.day}</div>;
				}
			);
		`,
		errors: [{ messageId }],
		filename,
		output: tsx`
			import { memo } from "react";

			interface Props {
				day: string;
			}

			export const App = memo(
				function App({ day }: Props) {
					return <div ref={ref}>{day}</div>;
				}
			);
		`,
	},
	// Nested `memo(forwardRef(...))`: fixable.
	{
		code: tsx`
			import { memo, forwardRef } from "react";

			interface Props {
				day: string;
			}

			export const App = memo(
				forwardRef<HTMLDivElement, Props>(
					function App(props, ref) {
						return <div ref={ref}>{props.day}</div>;
					}
				)
			);
		`,
		errors: [{ messageId }],
		filename,
		output: tsx`
			import { memo, forwardRef } from "react";

			interface Props {
				day: string;
			}

			export const App = memo(
				forwardRef<HTMLDivElement, Props>(
					function App({ day }, ref) {
						return <div ref={ref}>{day}</div>;
					}
				)
			);
		`,
	},
	// Multiple accesses, `props` also destructured wholesale: report only.
	{
		code: tsx`
			const App = (props) => {
				const { h, i } = props
				return (
					<div>
						<span>{props.name}</span>
						<span>{props.age}</span>
						<button onClick={() => console.log(props.id)}>Click</button>
					</div>
				)
			}
		`,
		errors: [{ messageId }, { messageId }, { messageId }],
		filename,
		output: null,
	},
	// The accessed name collides with a local binding: report only, no fix.
	{
		code: tsx`
			const NestedComponent = (props) => {
				const data = props.data || {}
				return (
					<div>
						<span>{data?.user?.name}</span>
						<span>{data?.user?.email}</span>
					</div>
				)
			}
		`,
		errors: [{ messageId }],
		filename,
		output: null,
	},
	// The accessed name is shadowed by a binding in a nested scope: report only,
	// since rewriting `props.id` to `id` would resolve to the inner binding.
	{
		code: tsx`
			function App(props) {
				return <ul>{[1, 2].map((id) => <li key={id}>{props.id}</li>)}</ul>
			}
		`,
		errors: [{ messageId }],
		filename,
		output: null,
	},
	// An un-parenthesized single arrow parameter is wrapped in parentheses.
	{
		code: "const App = props => <div id={props.id} />",
		errors: [{ messageId }],
		filename,
		output: "const App = ({ id }) => <div id={id} />",
	},
	// An arrow passed to a wrapper call is still parenthesized correctly.
	{
		code: tsx`
			import { memo } from "react";

			export const App = memo(props => <div id={props.id} />);
		`,
		errors: [{ messageId }],
		filename,
		output: tsx`
			import { memo } from "react";

			export const App = memo(({ id }) => <div id={id} />);
		`,
	},
	// A reserved word cannot be a binding: report only, no fix.
	{
		code: tsx`
			function App(props) {
				return <div className={props.default} />
			}
		`,
		errors: [{ messageId }],
		filename,
		output: null,
	},
	// A typed arrow parameter: fixable, type annotation preserved.
	{
		code: tsx`
			interface Props {
				id: string;
				className: string;
			}

			const App = (props: Props) => <div id={props.id} className={props.className} />;
		`,
		errors: [{ messageId }, { messageId }],
		filename,
		output: tsx`
			interface Props {
				id: string;
				className: string;
			}

			const App = ({ id, className }: Props) => <div id={id} className={className} />;
		`,
	},
	// A typed arrow parameter with a block body.
	{
		code: tsx`
			interface Props {
				items: Array<string>;
			}

			const App = (props: Props) => {
				return <div>{props.items}</div>;
			};
		`,
		errors: [{ messageId }],
		filename,
		output: tsx`
			interface Props {
				items: Array<string>;
			}

			const App = ({ items }: Props) => {
				return <div>{items}</div>;
			};
		`,
	},
	// An inline object type annotation is preserved.
	{
		code: tsx`
			function App(props: { id: string; className: string }) {
				return <div id={props.id} className={props.className} />;
			}
		`,
		errors: [{ messageId }, { messageId }],
		filename,
		output: tsx`
			function App({ id, className }: { id: string; className: string }) {
				return <div id={id} className={className} />;
			}
		`,
	},
	// A generic arrow component keeps its type parameters and annotation.
	{
		code: tsx`
			interface Props<T> {
				value: T;
			}

			const App = <T,>(props: Props<T>) => <div>{props.value}</div>;
		`,
		errors: [{ messageId }],
		filename,
		output: tsx`
			interface Props<T> {
				value: T;
			}

			const App = <T,>({ value }: Props<T>) => <div>{value}</div>;
		`,
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
	rule: preferDestructuringAssignment,
	valid,
});
