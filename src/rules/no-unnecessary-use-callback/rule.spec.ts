import {
	type InvalidTestCase,
	unindent as tsx,
	type ValidTestCase,
} from "eslint-vitest-rule-tester";

import { run } from "../test";
import { noUnnecessaryUseCallback, RULE_NAME } from "./rule";

const filename = "file.tsx";

const valid: Array<ValidTestCase> = [
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
			import { useCallback } from "react";

			const Comp = ({ theme }) => {
				const style = useCallback(() => ({
					input: {
						fontFamily: theme.fontFamilyMonospace
					}
				}), [theme.fontFamilyMonospace]);
				return <Button sx={style} />
			}
		`,
		filename,
	},
	{
		code: tsx`
			import { useState, useCallback } from "react";

			function MyComponent() {
				const [showSnapshot, setShowSnapshot] = useState(false);
				const handleSnapshot = useCallback(() => setShowSnapshot(true), []);

				return null;
			}
		`,
		filename,
	},
	{
		code: tsx`
			import { useCallback } from "react";

			const Comp = () => {
				const [width, setWidth] = useState<undefined | number>(undefined)
				const [open, setOpen] = useState<boolean>(false)
				const [title, setTitle] = useState<string | undefined>(undefined)

				const refItem = useCallback(() => {
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
			import { useCallback } from "react";
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
				const refItem = useCallback(cb, deps)
			};
		`,
		filename,
	},
	{
		code: tsx`
			import { useCallback, useState, useEffect } from 'react';

			function App({ items }) {
				const [test, setTest] = useState(items.length);

				const updateTest = useCallback(() => { setTest(items.length + 1) }, [setTest, items]);

				useEffect(function () {
					function foo() {
						updateTest();
					}

					foo();

					updateTest();
				}, [updateTest])

				return <div onClick={() => updateTest()}>{test}</div>;
			}
		`,
		filename,
	},
	{
		code: tsx`
			import { useCallback, useState, useEffect } from 'react';

			const Component = () => {
				const [test, setTest] = useState(items.length);

				const updateTest = useCallback(() => { setTest(items.length + 1) }, [setTest, items]);

				useEffect(() => {
					// some condition
					updateTest();
				}, [updateTest]);

				useEffect(() => {
					// some condition
					updateTest();
				}, [updateTest]);

				return <div />;
			};
		`,
		filename,
	},
	{
		code: tsx`
			import { useCallback, useState, useEffect } from 'react';

			const Component = () => {
				const [test, setTest] = useState(items.length);

				const updateTest = useCallback(() => { setTest(items.length + 1) }, [setTest, items]);

				return <div ref={() => updateTest()} />;
			};
		`,
		filename,
	},
	{
		code: tsx`
			import { useCallback, useState, useEffect } from 'react';

			const Component = () => {
				const [test, setTest] = useState(items.length);

				const updateTest = useCallback(() => { setTest(items.length + 1) }, [setTest, items]);

				return <div onClick={updateTest} />;
			};
		`,
		filename,
	},
];

const invalid: Array<InvalidTestCase> = [
	{
		code: tsx`
			import { useState, useCallback } from "react";

			function MyComponent() {
				const a = 1;
				const handleSnapshot = useCallback(() => Number(1), []);

				return null;
			}
		`,
		errors: [{ messageId: "default" }],
		filename,
	},
	{
		code: tsx`
			import { useState, useCallback } from "react";

			function MyComponent() {
				const a = 1;
				const handleSnapshot = useCallback(() => new String("1"), []);

				return null;
			}
		`,
		errors: [{ messageId: "default" }],
		filename,
	},
	{
		code: tsx`
			import { useCallback } from "react";

			const Comp = () => {
				const onClick = useCallback(() => {
					console.log("clicked");
				}, []);

				return <Button onClick={onClick} />;
			};
		`,
		errors: [{ messageId: "default" }],
		filename,
	},
	{
		code: tsx`
			import { useCallback } from "react";

			const deps = [];
			const Comp = () => {
				const onClick = useCallback(() => {
					console.log("clicked");
				}, deps);

				return <Button onClick={onClick} />;
			};
		`,
		errors: [{ messageId: "default" }],
		filename,
	},
	{
		code: tsx`
			import { useCallback } from "react";

			const Comp = () => {
				const deps = [];
				const onClick = useCallback(() => {
					console.log("clicked");
				}, deps);

				return <Button onClick={onClick} />;
			};
		`,
		errors: [{ messageId: "default" }],
		filename,
	},
	{
		code: tsx`
			import { useCallback } from "react";

			const Comp = () => {
				const style = useCallback((theme) => ({
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
			const { useCallback } = require("react");

			const Comp = () => {
				const style = useCallback((theme) => ({
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
			import React from "react";

			const Comp = () => {
				const style = React.useCallback((theme) => ({
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
			import React from "roact";

			function App({ items }) {
				const memoizedValue = React.useCallback(() => [0, 1, 2].sort(), []);

				return <div>{count}</div>;
			}
		`,
		errors: [{ messageId: "default" }],
		filename,
		settings: {
			"react-x": {
				importSource: "roact",
			},
		},
	},
	{
		code: tsx`
			import Roact from "roact";

			function App({ items }) {
				const memoizedValue = Roact.useCallback(() => [0, 1, 2].sort(), []);

				return <div>{count}</div>;
			}
		`,
		errors: [{ messageId: "default" }],
		filename,
		settings: {
			"react-x": {
				importSource: "roact",
			},
		},
	},
	{
		code: tsx`
			import { useCallback } from "roact";

			function App({ items }) {
				const memoizedValue = useCallback(() => [0, 1, 2].sort(), []);

				return <div>{count}</div>;
			}
		`,
		errors: [{ messageId: "default" }],
		filename,
		settings: {
			"react-x": {
				importSource: "roact",
			},
		},
	},
	{
		code: tsx`
			import React from "@pika/react";

			function App({ items }) {
				const memoizedValue = React.useCallback(() => [0, 1, 2].sort(), []);

				return <div>{count}</div>;
			}
		`,
		errors: [{ messageId: "default" }],
		filename,
		settings: {
			"react-x": {
				importSource: "@pika/react",
			},
		},
	},
	{
		code: tsx`
			import Pika from "@pika/react";

			function App({ items }) {
				const memoizedValue = Pika.useCallback(() => [0, 1, 2].sort(), []);

				return <div>{count}</div>;
			}
		`,
		errors: [{ messageId: "default" }],
		filename,
		settings: {
			"react-x": {
				importSource: "@pika/react",
			},
		},
	},
	{
		code: tsx`
			import { useCallback } from "@pika/react";

			function App({ items }) {
				const memoizedValue = useCallback(() => [0, 1, 2].sort(), []);

				return <div>{count}</div>;
			}
		`,
		errors: [{ messageId: "default" }],
		filename,
		settings: {
			"react-x": {
				importSource: "@pika/react",
			},
		},
	},
	{
		code: tsx`
			const React = require("roact");

			function App({ items }) {
				const memoizedValue = React.useCallback(() => [0, 1, 2].sort(), []);

				return <div>{count}</div>;
			}
		`,
		errors: [{ messageId: "default" }],
		filename,
		settings: {
			"react-x": {
				importSource: "roact",
			},
		},
	},
	{
		code: tsx`
			const Roact = require("roact");

			function App({ items }) {
				const memoizedValue = Roact.useCallback(() => [0, 1, 2].sort(), []);

				return <div>{count}</div>;
			}
		`,
		errors: [{ messageId: "default" }],
		filename,
		settings: {
			"react-x": {
				importSource: "roact",
			},
		},
	},
	{
		code: tsx`
			const { useCallback } = require("roact");

			function App({ items }) {
				const memoizedValue = useCallback(() => [0, 1, 2].sort(), []);

				return <div>{count}</div>;
			}
		`,
		errors: [{ messageId: "default" }],
		filename,
		settings: {
			"react-x": {
				importSource: "roact",
			},
		},
	},
	{
		code: tsx`
			const React = require("@pika/react");

			function App({ items }) {
				const memoizedValue = React.useCallback(() => [0, 1, 2].sort(), []);

				return <div>{count}</div>;
			}
		`,
		errors: [{ messageId: "default" }],
		filename,
		settings: {
			"react-x": {
				importSource: "@pika/react",
			},
		},
	},
	{
		code: tsx`
			const Pika = require("@pika/react");

			function App({ items }) {
				const memoizedValue = Pika.useCallback(() => [0, 1, 2].sort(), []);

				return <div>{count}</div>;
			}
		`,
		errors: [{ messageId: "default" }],
		filename,
		settings: {
			"react-x": {
				importSource: "@pika/react",
			},
		},
	},
	{
		code: tsx`
			const { useCallback } = require("@pika/react");

			function App({ items }) {
				const memoizedValue = useCallback(() => [0, 1, 2].sort(), []);

				return <div>{count}</div>;
			}
		`,
		errors: [{ messageId: "default" }],
		filename,
		settings: {
			"react-x": {
				importSource: "@pika/react",
			},
		},
	},
	{
		code: tsx`
			import {useCallback, useState, useEffect} from 'react';

			function App({ items }) {
				const [test, setTest] = useState(0);

				const updateTest = useCallback(() => {setTest(items.length)}, [items]);

				useEffect(() => {
					updateTest();
				}, [updateTest]);

				return <div>items</div>;
			}
		`,
		errors: [{ messageId: "noUnnecessaryUseCallbackInsideUseEffect" }],
		filename,
		settings: {
			"react-x": {
				importSource: "react",
			},
		},
	},
	{
		code: tsx`
			import {useCallback, useState, useEffect} from 'react';

			function App({ items }) {
				const [test, setTest] = useState(0);

				const updateTest = useCallback(() => {console.log('test')}, []);

				useEffect(() => {
					updateTest();
				}, [updateTest]);

				return <div>items</div>;
			}
		`,
		errors: [{ messageId: "default" }],
		filename,
		settings: {
			"react-x": {
				importSource: "react",
			},
		},
	},
	{
		code: tsx`
			import {useCallback, useState, useEffect} from 'react';

			function App({ items }) {
				const [test, setTest] = useState(0);

				const updateTest = useCallback(() => {setTest(items.length)}, [items]);

				useEffect(() => {
					updateTest();
				}, [updateTest]);

				return <div>items</div>;
			}

			function App2({ items }) {
				const [test, setTest] = useState(0);

				const updateTest = useCallback(() => {setTest(items.length)}, [items]);

				useEffect(() => {
					updateTest();
				}, [updateTest]);

				return <div>items</div>;
			}
		`,
		errors: [
			{ messageId: "noUnnecessaryUseCallbackInsideUseEffect" },
			{ messageId: "noUnnecessaryUseCallbackInsideUseEffect" },
		],
		filename,
		settings: {
			"react-x": {
				importSource: "react",
			},
		},
	},
	{
		code: tsx`
			const { useCallback, useEffect } = require("@pika/react");

			function App({ items }) {
				const [test, setTest] = useState(0);

				const updateTest = useCallback(() => {setTest(items.length)}, [items]);

				useEffect(() => {
					updateTest();
				}, [updateTest]);

				return <div>items</div>;
			}
		`,
		errors: [{ messageId: "noUnnecessaryUseCallbackInsideUseEffect" }],
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
	rule: noUnnecessaryUseCallback,
	valid,
});
