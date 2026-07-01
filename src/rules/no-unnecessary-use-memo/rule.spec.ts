import {
	type InvalidTestCase,
	unindent as tsx,
	type ValidTestCase,
} from "eslint-vitest-rule-tester";

import { run } from "../test";
import { noUnnecessaryUseMemo, RULE_NAME } from "./rule";

const filename = "file.tsx";

const valid: Array<ValidTestCase> = [
	{
		code: tsx`
			function Component() {
				const foo = "foo";
				const bar = useMemo(() => foo, [foo]);
			}
		`,
		filename,
	},
	{
		code: tsx`
			import { useState } from "react";

			const Comp = () => {
				const [state, setState] = useState(false);

				return <Button />;
			};
		`,
		filename,
	},
	{
		code: tsx`
			const useData = (key) => {
				return useSWR(key);
			}
		`,
		filename,
	},
	{
		code: tsx`
			function useData(key) {
				return useSWR(key);
			}
		`,
		filename,
	},
	{
		code: tsx`
			function useData(key) {
				const data = useSWR(key);
				return data;
			}
		`,
		filename,
	},
	{
		code: tsx`
			const useData = (key) => useSWR(key);
		`,
		filename,
	},
	{
		code: tsx`
			const onClick = () => {
				console.log("clicked");
			};

			const Comp = () => {
				return <Button onClick={onClick} />;
			};
		`,
		filename,
	},
	{
		code: tsx`
			import { useMemo } from "react";

			function App({ items }) {
				const memoizedValue = useMemo(() => [...items].sort(), [items]);
				return <div>{count}</div>;
			}
		`,
		filename,
	},
	{
		code: tsx`
			import { useMemo } from "react";

			const Comp = () => {
				const [width, setWidth] = useState<undefined | number>(undefined)
				const [open, setOpen] = useState<boolean>(false)
				const [title, setTitle] = useState<string | undefined>(undefined)

				const refItem = useMemo(() => {
					return {
						setWidth,
						setWrap: setOpen,
						setWrapperName: setTitle,
					}
				}, [])
			};
		`,
		filename,
	},
	{
		code: tsx`
			import { useMemo } from "react";
			const deps = []
			const Comp = () => {
				const [width, setWidth] = useState<undefined | number>(undefined)
				const [open, setOpen] = useState<boolean>(false)
				const [title, setTitle] = useState<string | undefined>(undefined)
				const cb = () => {
					return {
						setWidth,
						setWrap: setOpen,
						setWrapperName: setTitle,
					}
				}
				const refItem = useMemo(cb, deps)
			};
		`,
		filename,
	},
	{
		code: tsx`
			import { useState, useMemo } from "react";

			function MyComponent() {
				const [showSnapshot, setShowSnapshot] = useState(false);
				const handleSnapshot = useMemo(() => {
					return () => setShowSnapshot(true)
				}, []);

				return null;
			}
		`,
		filename,
	},
	{
		code: tsx`
			import { useState, useMemo } from "react";

			function MyComponent() {
				const [showSnapshot, setShowSnapshot] = useState(false);
				const handleSnapshot = useMemo(() => () => setShowSnapshot(true), []);

				return null;
			}
		`,
		filename,
	},
	{
		code: tsx`
			import { useState, useMemo } from "react";

			function MyComponent() {
				const [showSnapshot, setShowSnapshot] = useState(false);
				const handleSnapshot = useMemo(() => () => () => setShowSnapshot(true), []);

				return null;
			}
		`,
		filename,
	},
	{
		code: tsx`
			import { useState, useMemo } from "react";

			function MyComponent() {
				const a = 1;
				const handleSnapshot = useMemo(() => () => () => console.log(a), []);

				return null;
			}
		`,
		filename,
	},
	{
		code: tsx`
			import { useState, useMemo } from "react";

			function MyComponent() {
				const a = 1;
				const handleSnapshot = useMemo(() => Date.now(), []);

				return null;
			}
		`,
		filename,
	},
	{
		code: tsx`
			import { useState, useMemo } from "react";

			function MyComponent() {
				const a = 1;
				const handleSnapshot = useMemo(() => new Date(), []);

				return null;
			}
		`,
		filename,
	},
	// The following cases exercise call/new detection in less obvious positions;
	// each factory performs real computation, so none should be reported.
	{
		name: "useMemo with await expression containing a call in async arrow",
		code: tsx`
			import { useMemo } from "react";

			function Component({ url }) {
				const data = useMemo(async () => await fetchData(url), [url]);
				return null;
			}
		`,
		filename,
	},
	{
		name: "useMemo with tagged template expression containing a call",
		code: tsx`
			import { useMemo } from "react";

			function Component({ items }) {
				const query = useMemo(() => sql\`SELECT * FROM \${getTable(items)}\`, [items]);
				return null;
			}
		`,
		filename,
	},
	{
		name: "useMemo with call inside computed member expression property",
		code: tsx`
			import { useMemo } from "react";

			function Component({ data, key }) {
				const value = useMemo(() => data[getKey(key)], [data, key]);
				return null;
			}
		`,
		filename,
	},
	{
		name: "useMemo with chained call expression (callee is a call)",
		code: tsx`
			import { useMemo } from "react";

			function Component({ config }) {
				const result = useMemo(() => getFactory(config)(), [config]);
				return null;
			}
		`,
		filename,
	},
	{
		name: "useMemo with new expression inside callee via member expression",
		code: tsx`
			import { useMemo } from "react";

			function Component({ opts }) {
				const formatter = useMemo(() => new Intl.NumberFormat(opts).format, [opts]);
				return null;
			}
		`,
		filename,
	},
	{
		name: "useMemo with call inside import expression source",
		code: tsx`
			import { useMemo } from "react";

			function Component({ name }) {
				const mod = useMemo(() => import(getModulePath(name)), [name]);
				return null;
			}
		`,
		filename,
	},
	{
		code: tsx`
			import { useMemo, useState, useEffect } from 'react';

			function App({ items }) {
				const [test, setTest] = useState(0);
				const heavyStuff = useMemo(() => veryHeavyCalculation(items), [items]);

				useEffect(() => {
					setTest(heavyStuff.length)
				}, [heavyStuff]);

				return <div>{heavyStuff.length}</div>;
			}
		`,
		filename,
	},
	{
		code: tsx`
			import { useMemo, useState, useEffect } from 'react';

			function App({ items }) {
				const [test, setTest] = useState(0);
				const heavyStuff = useMemo(() => veryHeavyCalculation(items), [items]);

				useEffect(() => {
					setTest(heavyStuff.length)
				}, [heavyStuff]);

				useEffect(() => {
					console.log(heavyStuff)
				}, [heavyStuff]);

				return <div>{heavyStuff.length}</div>;
			}
		`,
		filename,
	},
	{
		code: tsx`
			import { useMemo } from 'react';

			function App({ items }) {
				const heavyStuff = useMemo(() => veryHeavyCalculation(items), [items]);

				return <div>{heavyStuff.length}</div>;
			}
		`,
		filename,
	},
];

const invalid: Array<InvalidTestCase> = [
	{
		code: tsx`
			function Component() {
				const bar = useMemo(() => "foo", []);
			}
		`,
		errors: [{ messageId: "default" }],
		filename,
	},
	{
		code: tsx`
			import { useMemo } from "react";

			const Comp = () => {
				const style = useMemo((theme) => ({
					input: {
						fontFamily: theme.fontFamilyMonospace
					}
				}), []);
				return <Button sx={style} />
			}
		`,
		errors: [{ messageId: "default" }],
		filename,
	},
	{
		code: tsx`
			import { useMemo } from "react";

			const deps = [];
			const Comp = () => {
				const style = useMemo((theme) => ({
					input: {
						fontFamily: theme.fontFamilyMonospace
					}
				}), deps);
				return <Button sx={style} />
			}
		`,
		errors: [{ messageId: "default" }],
		filename,
	},
	{
		code: tsx`
			import { useMemo } from "react";

			const Comp = () => {
				const deps = [];
				const style = useMemo((theme) => ({
					input: {
						fontFamily: theme.fontFamilyMonospace
					}
				}), deps);
				return <Button sx={style} />
			}
		`,
		errors: [{ messageId: "default" }],
		filename,
	},
	{
		code: tsx`
			import {useMemo, useState, useEffect} from 'react';

			function veryHeavyCalculation(items) {
				console.log(items)
				return items
			}

			function App({ items }) {
				const [test, setTest] = useState(0);
				const heavyStuff = useMemo(() => veryHeavyCalculation(items), [items]);

				useEffect(() => {
					setTest(heavyStuff.length)
				}, [heavyStuff]);

				return <div>items</div>;
			}
		`,
		errors: [{ messageId: "noUnnecessaryUseMemoInsideUseEffect" }],
		filename,
		settings: {
			"react-x": {
				importSource: "react",
			},
		},
	},
	{
		code: tsx`
			const { useMemo, useState, useEffect } = require("@pika/react");

			function App({ items }) {
				const [test, setTest] = useState(0);
				const heavyStuff = useMemo(() => veryHeavyCalculation(items), [items]);

				useEffect(() => {
					setTest(heavyStuff.length)
				}, [heavyStuff]);

				return <div>items</div>;
			}
		`,
		errors: [{ messageId: "noUnnecessaryUseMemoInsideUseEffect" }],
		filename,
		settings: {
			"react-x": {
				importSource: "@pika/react",
			},
		},
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
	rule: noUnnecessaryUseMemo,
	valid,
});
