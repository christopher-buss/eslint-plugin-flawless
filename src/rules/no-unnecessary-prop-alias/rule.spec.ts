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
		filename,
		code: tsx`
			function Panel({ options, gap = 4, ...rest }: PanelProps) {
				return <div style={{ gap }} {...rest}>{options}</div>;
			}
		`,
	},
	// Fallback without an alias.
	{
		filename,
		code: tsx`
			function Panel({ options }: PanelProps) {
				const { spacing, padding } = options ?? defaultOptions;
				return <div style={{ gap: spacing, padding }} />;
			}
		`,
	},
	// A component-valued prop rendered as JSX.
	{
		filename,
		code: tsx`
			function Field({ label: Label }: FieldProps) {
				return <Label />;
			}
		`,
	},
	{
		filename,
		code: tsx`
			function Field({ icon: Icon = DefaultIcon }: FieldProps) {
				return <div><Icon.Small /></div>;
			}
		`,
	},
	{
		filename,
		code: tsx`
			function Field(props: FieldProps) {
				const { label: Label } = props;
				return <Label>text</Label>;
			}
		`,
	},
	// The prop name is an outer binding that the component reads.
	{
		filename,
		code: tsx`
			import { value } from "./store";
			function Input({ value: inputValue }: InputProps) {
				return <input value={inputValue} defaultValue={value} />;
			}
		`,
	},
	// The prop name is an unrelated local binding.
	{
		filename,
		code: tsx`
			function Row({ id: rowId }: RowProps) {
				const { id } = useContext(RowContext);
				return <div data-row={rowId} data-id={id} />;
			}
		`,
	},
	// Swapped names.
	{
		filename,
		code: tsx`
			function Pair({ left: right, right: left }: PairProps) {
				return <div>{left}{right}</div>;
			}
		`,
	},
	// The prop name is bound in a nested scope that uses the alias.
	{
		filename,
		code: tsx`
			function List({ items: entries }: ListProps) {
				return <ul>{entries.map((items) => <li>{items}{entries.length}</li>)}</ul>;
			}
		`,
	},
	// The prop name is not a valid binding name.
	{
		filename,
		code: tsx`
			function Label({ for: htmlFor, "aria-label": ariaLabel, [key]: dynamic }: LabelProps) {
				return <label htmlFor={htmlFor} aria-label={ariaLabel}>{dynamic}</label>;
			}
		`,
	},
	// Destructuring that is not component props.
	{
		filename,
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
	},
	// The local with the prop name is not a fallback for the alias.
	{
		filename,
		code: tsx`
			function Input({ value: initialValue }: InputProps) {
				const [value, setValue] = useState(initialValue);
				return <input value={value} onChange={(event) => setValue(event.target.value)} />;
			}
		`,
	},
	{
		filename,
		code: tsx`
			function Price({ amount: rawAmount }: PriceProps) {
				const amount = parseFloat(rawAmount);
				return <span>{amount}</span>;
			}
		`,
	},
	// The code reads the alias after the fallback, so both names are needed.
	{
		filename,
		code: tsx`
			function Input({ value: rawValue }: InputProps) {
				const value = rawValue ?? "";
				return <input value={value} data-empty={rawValue === undefined} />;
			}
		`,
	},
	// A fallback in a nested scope: the rename would read the local too early.
	{
		filename,
		code: tsx`
			function List({ items: all }: ListProps) {
				const count = () => {
					const items = all.filter(Boolean);
					return items.length;
				};
				return <ul>{count()}</ul>;
			}
		`,
	},
	// A JSX tag reads an outer binding with the prop name.
	{
		filename,
		code: tsx`
			import { Icon } from "./icons";
			function Field({ Icon: CustomIcon }: FieldProps) {
				return <><Icon /><CustomIcon /></>;
			}
		`,
	},
	// With reportConflicts, aliases that renaming another binding cannot remove.
	{
		filename,
		code: tsx`
			function Field({ label: Label, for: htmlFor }: FieldProps) {
				return <Label htmlFor={htmlFor} />;
			}
		`,
		options: [{ reportConflicts: true }],
	},
	// Render callbacks are not components.
	{
		filename,
		code: tsx`
			function List({ items }: ListProps) {
				return <ul>{items.map(({ id: itemId }) => <li key={itemId} />)}</ul>;
			}
			const renderRow = ({ row: entry }: RowArguments) => <tr>{entry}</tr>;
		`,
	},
	// A nested pattern is not an alias.
	{
		filename,
		code: tsx`
			function Box({ style: { color } }: BoxProps) {
				return <div>{color}</div>;
			}
		`,
	},
	// Destructuring another object inside a component.
	{
		filename,
		code: tsx`
			function Card({ user }: CardProps) {
				const { name: userName } = user;
				return <div>{userName}</div>;
			}
		`,
	},
];

const invalid: Array<InvalidTestCase> = [
	// The case from the rule's request.
	{
		filename,
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
	},
	// Alias with a default.
	{
		filename,
		code: tsx`
			const Panel = ({ title: providedTitle = "Untitled" }: PanelProps) => {
				return <h1>{providedTitle}</h1>;
			};
		`,
		errors: [{ data: { key: "title", alias: "providedTitle" }, messageId }],
	},
	// Parameter with a default.
	{
		filename,
		code: tsx`
			function Panel({ title: heading }: PanelProps = {}) {
				return <h1>{heading}</h1>;
			}
		`,
		errors: [{ messageId }],
	},
	// From a props variable.
	{
		filename,
		code: tsx`
			function Panel(props: PanelProps) {
				const { options: configuredOptions, title } = props;
				return <div title={title}>{configuredOptions}</div>;
			}
		`,
		errors: [{ data: { key: "options", alias: "configuredOptions" }, line: 2, messageId }],
	},
	// From a rest element of the props.
	{
		filename,
		code: tsx`
			function Panel({ title, ...rest }: PanelProps) {
				const { options: panelOptions } = rest;
				return <div title={title}>{panelOptions}</div>;
			}
		`,
		errors: [{ data: { key: "options", alias: "panelOptions" }, messageId }],
	},
	{
		filename,
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
	},
	// A PascalCase prop name can already be a JSX tag.
	{
		filename,
		code: tsx`
			function Field({ Icon: IconComponent }: FieldProps) {
				return <IconComponent />;
			}
		`,
		errors: [{ data: { key: "Icon", alias: "IconComponent" }, messageId }],
	},
	// A prop name bound in a nested scope that does not use the alias.
	{
		filename,
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
	},
	// Through type assertions.
	{
		filename,
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
	},
	// A string key that is a valid binding name.
	{
		filename,
		code: tsx`
			function Panel({ "title": heading }: PanelProps) {
				return <h1>{heading}</h1>;
			}
		`,
		errors: [{ data: { key: "title", alias: "heading" }, messageId }],
	},
	// A TypeScript \`this\` parameter comes before the props.
	{
		filename,
		code: tsx`
			function Panel(this: void, { title: heading }: PanelProps) {
				return <h1>{heading}</h1>;
			}
		`,
		errors: [{ messageId }],
	},
	// With reportConflicts, an alias that avoids a name conflict.
	{
		filename,
		code: tsx`
			import { value } from "./store";
			function Input({ value: inputValue }: InputProps) {
				return <input value={inputValue} defaultValue={value} />;
			}
		`,
		options: [{ reportConflicts: true }],
		errors: [{ data: { key: "value", alias: "inputValue" }, messageId: "conflictingAlias" }],
	},
	{
		filename,
		code: tsx`
			function Row(props: RowProps) {
				const { id: rowId, title: heading } = props;
				const { id } = useContext(RowContext);
				return <div data-row={rowId} data-id={id}>{heading}</div>;
			}
		`,
		options: [{ reportConflicts: true }],
		errors: [
			{ data: { key: "id", alias: "rowId" }, messageId: "conflictingAlias" },
			{ data: { key: "title", alias: "heading" }, messageId },
		],
	},
	{
		filename,
		code: tsx`
			function Input({ value: initialValue }: InputProps) {
				const [value, setValue] = useState(initialValue);
				return <input value={value} onChange={(event) => setValue(event.target.value)} />;
			}
		`,
		options: [{ reportConflicts: true }],
		errors: [{ messageId: "conflictingAlias" }],
	},
	// memo and forwardRef components.
	{
		filename,
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
			filename: "file.jsx",
			code: "function Panel({ title: heading }) { return <h1>{heading}</h1>; }",
			errors: [{ messageId }],
		},
		{
			filename: "file.jsx",
			code: 'import { Icon } from "./icons"; function Field({ Icon: I }) { return <><Icon /><I /></>; }',
			options: [{ reportConflicts: true }],
			errors: [{ messageId: "conflictingAlias" }],
		},
	],
	languageOptions: {
		parserOptions: { ecmaFeatures: { jsx: true } },
	},
	rule: noUnnecessaryPropertyAlias,
	valid: [
		{
			filename: "file.jsx",
			code: "function Field({ label: Label }) { return <Label />; }",
		},
		{
			filename: "file.jsx",
			code: 'import { Icon } from "./icons"; function Field({ Icon: I }) { return <><Icon /><I /></>; }',
		},
	],
});
