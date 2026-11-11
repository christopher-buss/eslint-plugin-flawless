import type { InvalidTestCase, ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { reactNamespace, RULE_NAME } from "./rule";

const runtimeNamespace = "runtimeNamespace";
const typeNamedImport = "typeNamedImport";
const filename = "file.tsx";

// The `@rbxts/react` source exercises the `react-x` `importSource` setting; every
// case runs once against the default `"react"` and once against `"@rbxts/react"`.
const rbx = { "react-x": { importSource: "@rbxts/react" } } as const;

// Roblox configs set `importSource` to the bare scope `@rbxts`, under which the
// React package is `@rbxts/react` — sibling packages must stay untouched.
const scope = { "react-x": { importSource: "@rbxts" } } as const;

const valid: Array<ValidTestCase> = [
	// A named runtime import is already used — nothing to rewrite.
	{ filename, code: 'import { useEffect } from "react";\nuseEffect();' },
	{
		filename,
		code: 'import { useEffect } from "@rbxts/react";\nuseEffect();',
		settings: rbx,
	},
	// A namespace *type* access is already the desired form.
	{ filename, code: 'import React from "react";\ntype X = React.ReactNode;' },
	{
		filename,
		code: 'import React from "@rbxts/react";\ntype X = React.ReactNode;',
		settings: rbx,
	},
	// A bare type from a non-React module is unrelated.
	{ filename, code: 'import type { Foo } from "./types";\ntype X = Foo;' },
	{
		filename,
		code: 'import type { Foo } from "./types";\ntype X = Foo;',
		settings: rbx,
	},
	// Computed access cannot be rewritten to a bare identifier.
	{ filename, code: 'import React from "react";\nReact["useEffect"]();' },
	{
		filename,
		code: 'import React from "@rbxts/react";\nReact["useEffect"]();',
		settings: rbx,
	},
	// A member access on a non-React binding is untouched.
	{ filename, code: "const obj = { a() {} };\nobj.a();" },
	// Under a bare-scope `importSource`, a sibling package is not React: a
	// namespace access on `@rbxts/react-roblox` must not be rewritten (nor
	// wrongly folded into the `@rbxts/react` import).
	{
		filename,
		code: 'import ReactRoblox from "@rbxts/react-roblox";\nReactRoblox.createRoot();',
		settings: scope,
	},
	// Likewise a bare named *type* from an unrelated `@rbxts` package stays put.
	{
		filename,
		code: 'import type { ActionMap } from "@rbxts/flux";\nlet x: ActionMap;',
		settings: scope,
	},
];

const invalid: Array<InvalidTestCase> = [
	// ── Runtime: ban namespace access, prefer named imports ──────────

	// Extends an existing named import.
	{
		filename,
		code: 'import React, { useState } from "react";\nReact.useEffect();',
		output: 'import React, { useState, useEffect } from "react";\nuseEffect();',
		errors: [{ messageId: runtimeNamespace }],
	},
	{
		filename,
		code: 'import React, { useState } from "@rbxts/react";\nReact.useEffect();',
		output: 'import React, { useState, useEffect } from "@rbxts/react";\nuseEffect();',
		errors: [{ messageId: runtimeNamespace }],
		settings: rbx,
	},
	// Appends a named list to a default-only import.
	{
		filename,
		code: 'import React from "react";\nReact.useEffect();',
		output: 'import React, { useEffect } from "react";\nuseEffect();',
		errors: [{ messageId: runtimeNamespace }],
	},
	{
		filename,
		code: 'import React from "@rbxts/react";\nReact.useEffect();',
		output: 'import React, { useEffect } from "@rbxts/react";\nuseEffect();',
		errors: [{ messageId: runtimeNamespace }],
		settings: rbx,
	},
	// A bare-scope `importSource` still resolves to `@rbxts/react`, so the real
	// React package is rewritten as usual.
	{
		filename,
		code: 'import React from "@rbxts/react";\nReact.useEffect();',
		output: 'import React, { useEffect } from "@rbxts/react";\nuseEffect();',
		errors: [{ messageId: runtimeNamespace }],
		settings: scope,
	},
	// A namespace import cannot carry named siblings, so a fresh statement
	// is inserted.
	{
		filename,
		code: 'import * as React from "react";\nReact.useEffect();',
		output: 'import { useEffect } from "react";\nimport * as React from "react";\nuseEffect();',
		errors: [{ messageId: runtimeNamespace }],
	},
	{
		filename,
		code: 'import * as React from "@rbxts/react";\nReact.useEffect();',
		output: 'import { useEffect } from "@rbxts/react";\nimport * as React from "@rbxts/react";\nuseEffect();',
		errors: [{ messageId: runtimeNamespace }],
		settings: rbx,
	},

	// ── Types: require the namespace, ban bare named type imports ────

	// Sole named type import: qualify, add a React namespace import, drop
	// the redundant import entirely.
	{
		filename,
		code: 'import type { ReactNode } from "react";\nconst x: ReactNode = null;',
		output: 'import React from "react";\nconst x: React.ReactNode = null;',
		errors: [{ messageId: typeNamedImport }],
	},
	{
		filename,
		code: 'import type { ReactNode } from "@rbxts/react";\nconst x: ReactNode = null;',
		output: 'import React from "@rbxts/react";\nconst x: React.ReactNode = null;',
		errors: [{ messageId: typeNamedImport }],
		settings: rbx,
	},
	// Multiple references each qualify; the import is removed once.
	{
		filename,
		code: 'import type { ReactNode } from "react";\nlet a: ReactNode;\nlet b: ReactNode;',
		output: 'import React from "react";\nlet a: React.ReactNode;\nlet b: React.ReactNode;',
		errors: [{ messageId: typeNamedImport }, { messageId: typeNamedImport }],
	},
	// Mixed default + named import: reuse the existing React namespace and
	// strip only the named specifier.
	{
		filename,
		code: 'import React, { ReactNode } from "react";\nlet x: ReactNode;',
		output: 'import React from "react";\nlet x: React.ReactNode;',
		errors: [{ messageId: typeNamedImport }],
	},
	{
		filename,
		code: 'import React, { ReactNode } from "@rbxts/react";\nlet x: ReactNode;',
		output: 'import React from "@rbxts/react";\nlet x: React.ReactNode;',
		errors: [{ messageId: typeNamedImport }],
		settings: rbx,
	},
	// ── umdGlobal: rely on the `React` UMD global for types ──────────

	// Sole named type import: qualify and drop the whole declaration
	// without inserting a React import.
	{
		filename,
		code: 'import type { ReactNode } from "react";\ntype Node = ReactNode;',
		output: "export {};\ntype Node = React.ReactNode;",
		options: [{ umdGlobal: true }],
		errors: [{ messageId: typeNamedImport }],
	},
	{
		filename,
		code: 'import type { ReactNode } from "@rbxts/react";\ntype Node = ReactNode;',
		output: "export {};\ntype Node = React.ReactNode;",
		options: [{ umdGlobal: true }],
		errors: [{ messageId: typeNamedImport }],
		settings: rbx,
	},
	// Another import keeps the file a module, so no `export {}` is added.
	{
		filename,
		code: 'import type { ReactNode } from "react";\nimport { x } from "y";\ntype Node = ReactNode;',
		output: 'import { x } from "y";\ntype Node = React.ReactNode;',
		options: [{ umdGlobal: true }],
		errors: [{ messageId: typeNamedImport }],
	},
	// `export =` also keeps the file a module (and forbids `export {}`).
	{
		filename,
		code: 'import type { ReactNode } from "react";\ntype Node = ReactNode;\nexport = 1;',
		output: "type Node = React.ReactNode;\nexport = 1;",
		options: [{ umdGlobal: true }],
		errors: [{ messageId: typeNamedImport }],
	},
	// A foreign `React` binding shadows the global: report without a fix.
	{
		filename,
		code: 'import * as React from "some-other-lib";\nimport type { ReactNode } from "react";\ntype Node = ReactNode;',
		output: null,
		options: [{ umdGlobal: true }],
		errors: [{ messageId: typeNamedImport }],
	},
	{
		filename,
		code: 'import type { ReactNode } from "react";\nconst React = 1;\ntype Node = ReactNode;',
		output: null,
		options: [{ umdGlobal: true }],
		errors: [{ messageId: typeNamedImport }],
	},
	{
		filename,
		code: 'import type { ReactNode } from "react";\ntype React = string;\ntype Node = ReactNode;',
		output: null,
		options: [{ umdGlobal: true }],
		errors: [{ messageId: typeNamedImport }],
	},
	// An existing namespace import keeps its local name; nothing is inserted.
	{
		filename,
		code: 'import * as R from "react";\nimport type { ReactNode } from "react";\nlet x: ReactNode;',
		output: 'import * as R from "react";\nlet x: R.ReactNode;',
		options: [{ umdGlobal: true }],
		errors: [{ messageId: typeNamedImport }],
	},
	// A named import also used as a value stays; only the type is qualified.
	{
		filename,
		code: 'import { Component } from "react";\nclass A extends Component {}\nlet x: Component;',
		output: 'import { Component } from "react";\nclass A extends Component {}\nlet x: React.Component;',
		options: [{ umdGlobal: true }],
		errors: [{ messageId: typeNamedImport }],
	},
	// Other named specifiers survive; only the redundant one is removed.
	{
		filename,
		code: 'import { useState, type ReactNode } from "react";\nuseState();\nlet x: ReactNode;',
		output: 'import { useState } from "react";\nuseState();\nlet x: React.ReactNode;',
		options: [{ umdGlobal: true }],
		errors: [{ messageId: typeNamedImport }],
	},
	// Multiple references each qualify; the import is removed once.
	{
		filename,
		code: 'import type { ReactNode } from "react";\nlet a: ReactNode;\nlet b: ReactNode;',
		output: "export {};\nlet a: React.ReactNode;\nlet b: React.ReactNode;",
		options: [{ umdGlobal: true }],
		errors: [{ messageId: typeNamedImport }, { messageId: typeNamedImport }],
	},
	// An existing default import keeps its local name.
	{
		filename,
		code: 'import R, { ReactNode } from "react";\nlet x: ReactNode;',
		output: 'import R from "react";\nlet x: R.ReactNode;',
		options: [{ umdGlobal: true }],
		errors: [{ messageId: typeNamedImport }],
	},
	// Runtime direction is unaffected.
	{
		filename,
		code: 'import React from "react";\nReact.useEffect();',
		output: 'import React, { useEffect } from "react";\nuseEffect();',
		options: [{ umdGlobal: true }],
		errors: [{ messageId: runtimeNamespace }],
	},
	// `umdGlobal: false` keeps the default behavior.
	{
		filename,
		code: 'import type { ReactNode } from "react";\nconst x: ReactNode = null;',
		output: 'import React from "react";\nconst x: React.ReactNode = null;',
		options: [{ umdGlobal: false }],
		errors: [{ messageId: typeNamedImport }],
	},
];

run({
	name: RULE_NAME,
	// This rule is not type-aware, so opt out of the shared type-aware project
	// (which rejects virtual files) and enable JSX/TS parsing directly.
	invalid,
	parserOptions: {
		ecmaFeatures: { jsx: true },
		ecmaVersion: "latest",
		sourceType: "module",
	},
	rule: reactNamespace,
	valid,
});
