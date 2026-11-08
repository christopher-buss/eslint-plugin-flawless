import {
	type InvalidTestCase,
	run as runDefaultParser,
	unindent as tsx,
	type ValidTestCase,
} from "eslint-vitest-rule-tester";

import { run } from "../test";
import { noUnnecessaryPropertyAlias, RULE_NAME } from "./rule";

const messageId = "unnecessaryAlias";
const filename = "file.tsx";

const valid: Array<ValidTestCase> = [
	// Shorthand, defaults and rest.
	{
		code: tsx`
			function Panel({ options, gap = 4, ...rest }: PanelProps) {
				return <div style={{ gap }} {...rest}>{options}</div>;
			}
		`,
		filename,
	},
	// Fallback without an alias.
	{
		code: tsx`
			function Panel({ options }: PanelProps) {
				const { spacing, padding } = options ?? defaultOptions;
				return <div style={{ gap: spacing, padding }} />;
			}
		`,
		filename,
	},
	// A component-valued prop rendered as JSX.
	{
		code: tsx`
			function Field({ label: Label }: FieldProps) {
				return <Label />;
			}
		`,
		filename,
	},
	{
		code: tsx`
			function Field({ icon: Icon = DefaultIcon }: FieldProps) {
				return <div><Icon.Small /></div>;
			}
		`,
		filename,
	},
	{
		code: tsx`
			function Field(props: FieldProps) {
				const { label: Label } = props;
				return <Label>text</Label>;
			}
		`,
		filename,
	},
	// The prop name is an outer binding that the component reads.
	{
		code: tsx`
			import { value } from "./store";
			function Input({ value: inputValue }: InputProps) {
				return <input value={inputValue} defaultValue={value} />;
			}
		`,
		filename,
	},
	// The prop name is an unrelated local binding.
	{
		code: tsx`
			function Row({ id: rowId }: RowProps) {
				const { id } = useContext(RowContext);
				return <div data-row={rowId} data-id={id} />;
			}
		`,
		filename,
	},
	// Swapped names.
	{
		code: tsx`
			function Pair({ left: right, right: left }: PairProps) {
				return <div>{left}{right}</div>;
			}
		`,
		filename,
	},
	// The prop name is bound in a nested scope that uses the alias.
	{
		code: tsx`
			function List({ items: entries }: ListProps) {
				return <ul>{entries.map((items) => <li>{items}{entries.length}</li>)}</ul>;
			}
		`,
		filename,
	},
	// The prop name is not a valid binding name.
	{
		code: tsx`
			function Label({ for: htmlFor, "aria-label": ariaLabel, [key]: dynamic }: LabelProps) {
				return <label htmlFor={htmlFor} aria-label={ariaLabel}>{dynamic}</label>;
			}
		`,
		filename,
	},
	// Destructuring that is not component props.
	{
		code: tsx`
			import { useState as useLocalState } from "react";
			export { helper as renderHelper };
			const { client: apiClient } = services;
			function helper({ value: amount }: Options) {
				return amount * 2;
			}
			function Panel() {
				const { data: rows } = useQuery();
				const [state] = useLocalState(0);
				return <div>{rows}{state}</div>;
			}
			test("renders", () => {
				const { getByText: findText } = render(<Panel />);
				findText("x");
			});
		`,
		filename,
	},
	// The local with the prop name is not a fallback for the alias.
	{
		code: tsx`
			function Input({ value: initialValue }: InputProps) {
				const [value, setValue] = useState(initialValue);
				return <input value={value} onChange={(event) => setValue(event.target.value)} />;
			}
		`,
		filename,
	},
	{
		code: tsx`
			function Price({ amount: rawAmount }: PriceProps) {
				const amount = parseFloat(rawAmount);
				return <span>{amount}</span>;
			}
		`,
		filename,
	},
	// The code reads the alias after the fallback, so both names are needed.
	{
		code: tsx`
			function Input({ value: rawValue }: InputProps) {
				const value = rawValue ?? "";
				return <input value={value} data-empty={rawValue === undefined} />;
			}
		`,
		filename,
	},
	// A fallback in a nested scope: the rename would read the local too early.
	{
		code: tsx`
			function List({ items: all }: ListProps) {
				const count = () => {
					const items = all.filter(Boolean);
					return items.length;
				};
				return <ul>{count()}</ul>;
			}
		`,
		filename,
	},
	// A JSX tag reads an outer binding with the prop name.
	{
		code: tsx`
			import { Icon } from "./icons";
			function Field({ Icon: CustomIcon }: FieldProps) {
				return <><Icon /><CustomIcon /></>;
			}
		`,
		filename,
	},
	// With reportConflicts, aliases that renaming another binding cannot remove.
	{
		code: tsx`
			function Field({ label: Label, for: htmlFor }: FieldProps) {
				return <Label htmlFor={htmlFor} />;
			}
		`,
		filename,
		options: [{ reportConflicts: true }],
	},
	// Render callbacks are not components.
	{
		code: tsx`
			function List({ items }: ListProps) {
				return <ul>{items.map(({ id: itemId }) => <li key={itemId} />)}</ul>;
			}
			const renderRow = ({ row: entry }: RowArguments) => <tr>{entry}</tr>;
		`,
		filename,
	},
	// A nested pattern is not an alias.
	{
		code: tsx`
			function Box({ style: { color } }: BoxProps) {
				return <div>{color}</div>;
			}
		`,
		filename,
	},
	// Destructuring another object inside a component.
	{
		code: tsx`
			function Card({ user }: CardProps) {
				const { name: userName } = user;
				return <div>{userName}</div>;
			}
		`,
		filename,
	},
];

const invalid: Array<InvalidTestCase> = [
	// The case from the rule's request.
	{
		code: tsx`
			function Panel({ options: configuredOptions }: PanelProps) {
				const options = configuredOptions ?? defaultOptions;
				const { spacing, padding } = options;
				return <div style={{ gap: spacing, padding }} />;
			}
		`,
		errors: [
			{
				column: 18,
				data: { key: "options", alias: "configuredOptions" },
				line: 1,
				messageId,
			},
		],
		filename,
	},
	// Alias with a default.
	{
		code: tsx`
			const Panel = ({ title: providedTitle = "Untitled" }: PanelProps) => {
				return <h1>{providedTitle}</h1>;
			};
		`,
		errors: [{ data: { key: "title", alias: "providedTitle" }, messageId }],
		filename,
	},
	// Parameter with a default.
	{
		code: tsx`
			function Panel({ title: heading }: PanelProps = {}) {
				return <h1>{heading}</h1>;
			}
		`,
		errors: [{ messageId }],
		filename,
	},
	// From a props variable.
	{
		code: tsx`
			function Panel(props: PanelProps) {
				const { options: configuredOptions, title } = props;
				return <div title={title}>{configuredOptions}</div>;
			}
		`,
		errors: [{ data: { key: "options", alias: "configuredOptions" }, line: 2, messageId }],
		filename,
	},
	// From a rest element of the props.
	{
		code: tsx`
			function Panel({ title, ...rest }: PanelProps) {
				const { options: panelOptions } = rest;
				return <div title={title}>{panelOptions}</div>;
			}
		`,
		errors: [{ data: { key: "options", alias: "panelOptions" }, messageId }],
		filename,
	},
	{
		code: tsx`
			function Panel(props: PanelProps) {
				const { title, ...rest } = props;
				if (title) {
					const { options: panelOptions } = rest;
					return <div title={title}>{panelOptions}</div>;
				}
				return null;
			}
		`,
		errors: [{ line: 4, messageId }],
		filename,
	},
	// A PascalCase prop name can already be a JSX tag.
	{
		code: tsx`
			function Field({ Icon: IconComponent }: FieldProps) {
				return <IconComponent />;
			}
		`,
		errors: [{ data: { key: "Icon", alias: "IconComponent" }, messageId }],
		filename,
	},
	// A prop name bound in a nested scope that does not use the alias.
	{
		code: tsx`
			function List({ items: entries }: ListProps) {
				const render = () => {
					const items = 1;
					return items;
				};
				return <ul>{entries}{render()}</ul>;
			}
		`,
		errors: [{ messageId }],
		filename,
	},
	// Through type assertions.
	{
		code: tsx`
			function Panel(props: PanelProps) {
				const { title: heading } = props as TitledProps;
				const { size: panelSize } = props!;
				return <h1 data-size={panelSize}>{heading}</h1>;
			}
		`,
		errors: [
			{ line: 2, messageId },
			{ line: 3, messageId },
		],
		filename,
	},
	// A string key that is a valid binding name.
	{
		code: tsx`
			function Panel({ "title": heading }: PanelProps) {
				return <h1>{heading}</h1>;
			}
		`,
		errors: [{ data: { key: "title", alias: "heading" }, messageId }],
		filename,
	},
	// A TypeScript \`this\` parameter comes before the props.
	{
		code: tsx`
			function Panel(this: void, { title: heading }: PanelProps) {
				return <h1>{heading}</h1>;
			}
		`,
		errors: [{ messageId }],
		filename,
	},
	// With reportConflicts, an alias that avoids a name conflict.
	{
		code: tsx`
			import { value } from "./store";
			function Input({ value: inputValue }: InputProps) {
				return <input value={inputValue} defaultValue={value} />;
			}
		`,
		errors: [{ data: { key: "value", alias: "inputValue" }, messageId: "conflictingAlias" }],
		filename,
		options: [{ reportConflicts: true }],
	},
	{
		code: tsx`
			function Row(props: RowProps) {
				const { id: rowId, title: heading } = props;
				const { id } = useContext(RowContext);
				return <div data-row={rowId} data-id={id}>{heading}</div>;
			}
		`,
		errors: [
			{ data: { key: "id", alias: "rowId" }, messageId: "conflictingAlias" },
			{ data: { key: "title", alias: "heading" }, messageId },
		],
		filename,
		options: [{ reportConflicts: true }],
	},
	{
		code: tsx`
			function Input({ value: initialValue }: InputProps) {
				const [value, setValue] = useState(initialValue);
				return <input value={value} onChange={(event) => setValue(event.target.value)} />;
			}
		`,
		errors: [{ messageId: "conflictingAlias" }],
		filename,
		options: [{ reportConflicts: true }],
	},
	// memo and forwardRef components.
	{
		code: tsx`
			const Panel = memo(({ title: heading }: PanelProps) => <h1>{heading}</h1>);
			const Input = forwardRef((props: InputProps, ref) => {
				const { value: inputValue } = props;
				return <input ref={ref} value={inputValue} />;
			});
		`,
		errors: [
			{ line: 1, messageId },
			{ line: 3, messageId },
		],
		filename,
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
	rule: noUnnecessaryPropertyAlias,
	valid,
});

// ESLint's default parser does not record JSX tags as references.
void runDefaultParser({
	name: `${RULE_NAME} (default parser)`,
	invalid: [
		{
			code: "function Panel({ title: heading }) { return <h1>{heading}</h1>; }",
			errors: [{ messageId }],
			filename: "file.jsx",
		},
		{
			code: 'import { Icon } from "./icons"; function Field({ Icon: I }) { return <><Icon /><I /></>; }',
			errors: [{ messageId: "conflictingAlias" }],
			filename: "file.jsx",
			options: [{ reportConflicts: true }],
		},
	],
	languageOptions: {
		parserOptions: { ecmaFeatures: { jsx: true } },
	},
	rule: noUnnecessaryPropertyAlias,
	valid: [
		{
			code: "function Field({ label: Label }) { return <Label />; }",
			filename: "file.jsx",
		},
		{
			code: 'import { Icon } from "./icons"; function Field({ Icon: I }) { return <><Icon /><I /></>; }',
			filename: "file.jsx",
		},
	],
});
