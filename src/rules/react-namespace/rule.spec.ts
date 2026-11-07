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
	{ code: 'import { useEffect } from "react";\nuseEffect();', filename },
	{
		code: 'import { useEffect } from "@rbxts/react";\nuseEffect();',
		filename,
		settings: rbx,
	},
	// A namespace *type* access is already the desired form.
	{ code: 'import React from "react";\ntype X = React.ReactNode;', filename },
	{
		code: 'import React from "@rbxts/react";\ntype X = React.ReactNode;',
		filename,
		settings: rbx,
	},
	// A bare type from a non-React module is unrelated.
	{ code: 'import type { Foo } from "./types";\ntype X = Foo;', filename },
	{
		code: 'import type { Foo } from "./types";\ntype X = Foo;',
		filename,
		settings: rbx,
	},
	// Computed access cannot be rewritten to a bare identifier.
	{ code: 'import React from "react";\nReact["useEffect"]();', filename },
	{
		code: 'import React from "@rbxts/react";\nReact["useEffect"]();',
		filename,
		settings: rbx,
	},
	// A member access on a non-React binding is untouched.
	{ code: "const obj = { a() {} };\nobj.a();", filename },
	// Under a bare-scope `importSource`, a sibling package is not React: a
	// namespace access on `@rbxts/react-roblox` must not be rewritten (nor
	// wrongly folded into the `@rbxts/react` import).
	{
		code: 'import ReactRoblox from "@rbxts/react-roblox";\nReactRoblox.createRoot();',
		filename,
		settings: scope,
	},
	// Likewise a bare named *type* from an unrelated `@rbxts` package stays put.
	{
		code: 'import type { ActionMap } from "@rbxts/flux";\nlet x: ActionMap;',
		filename,
		settings: scope,
	},
];

const invalid: Array<InvalidTestCase> = [
	// ── Runtime: ban namespace access, prefer named imports ──────────

	// Extends an existing named import.
	{
		code: 'import React, { useState } from "react";\nReact.useEffect();',
		errors: [{ messageId: runtimeNamespace }],
		filename,
		output: 'import React, { useState, useEffect } from "react";\nuseEffect();',
	},
	{
		code: 'import React, { useState } from "@rbxts/react";\nReact.useEffect();',
		errors: [{ messageId: runtimeNamespace }],
		filename,
		output: 'import React, { useState, useEffect } from "@rbxts/react";\nuseEffect();',
		settings: rbx,
	},
	// Appends a named list to a default-only import.
	{
		code: 'import React from "react";\nReact.useEffect();',
		errors: [{ messageId: runtimeNamespace }],
		filename,
		output: 'import React, { useEffect } from "react";\nuseEffect();',
	},
	{
		code: 'import React from "@rbxts/react";\nReact.useEffect();',
		errors: [{ messageId: runtimeNamespace }],
		filename,
		output: 'import React, { useEffect } from "@rbxts/react";\nuseEffect();',
		settings: rbx,
	},
	// A bare-scope `importSource` still resolves to `@rbxts/react`, so the real
	// React package is rewritten as usual.
	{
		code: 'import React from "@rbxts/react";\nReact.useEffect();',
		errors: [{ messageId: runtimeNamespace }],
		filename,
		output: 'import React, { useEffect } from "@rbxts/react";\nuseEffect();',
		settings: scope,
	},
	// A namespace import cannot carry named siblings, so a fresh statement
	// is inserted.
	{
		code: 'import * as React from "react";\nReact.useEffect();',
		errors: [{ messageId: runtimeNamespace }],
		filename,
		output: 'import { useEffect } from "react";\nimport * as React from "react";\nuseEffect();',
	},
	{
		code: 'import * as React from "@rbxts/react";\nReact.useEffect();',
		errors: [{ messageId: runtimeNamespace }],
		filename,
		output: 'import { useEffect } from "@rbxts/react";\nimport * as React from "@rbxts/react";\nuseEffect();',
		settings: rbx,
	},

	// ── Types: require the namespace, ban bare named type imports ────

	// Sole named type import: qualify, add a React namespace import, drop
	// the redundant import entirely.
	{
		code: 'import type { ReactNode } from "react";\nconst x: ReactNode = null;',
		errors: [{ messageId: typeNamedImport }],
		filename,
		output: 'import React from "react";\nconst x: React.ReactNode = null;',
	},
	{
		code: 'import type { ReactNode } from "@rbxts/react";\nconst x: ReactNode = null;',
		errors: [{ messageId: typeNamedImport }],
		filename,
		output: 'import React from "@rbxts/react";\nconst x: React.ReactNode = null;',
		settings: rbx,
	},
	// Multiple references each qualify; the import is removed once.
	{
		code: 'import type { ReactNode } from "react";\nlet a: ReactNode;\nlet b: ReactNode;',
		errors: [{ messageId: typeNamedImport }, { messageId: typeNamedImport }],
		filename,
		output: 'import React from "react";\nlet a: React.ReactNode;\nlet b: React.ReactNode;',
	},
	// Mixed default + named import: reuse the existing React namespace and
	// strip only the named specifier.
	{
		code: 'import React, { ReactNode } from "react";\nlet x: ReactNode;',
		errors: [{ messageId: typeNamedImport }],
		filename,
		output: 'import React from "react";\nlet x: React.ReactNode;',
	},
	{
		code: 'import React, { ReactNode } from "@rbxts/react";\nlet x: ReactNode;',
		errors: [{ messageId: typeNamedImport }],
		filename,
		output: 'import React from "@rbxts/react";\nlet x: React.ReactNode;',
		settings: rbx,
	},
	// ── umdGlobal: rely on the `React` UMD global for types ──────────

	// Sole named type import: qualify and drop the whole declaration
	// without inserting a React import.
	{
		code: 'import type { ReactNode } from "react";\ntype Node = ReactNode;',
		errors: [{ messageId: typeNamedImport }],
		filename,
		options: [{ umdGlobal: true }],
		output: "export {};\ntype Node = React.ReactNode;",
	},
	{
		code: 'import type { ReactNode } from "@rbxts/react";\ntype Node = ReactNode;',
		errors: [{ messageId: typeNamedImport }],
		filename,
		options: [{ umdGlobal: true }],
		output: "export {};\ntype Node = React.ReactNode;",
		settings: rbx,
	},
	// Another import keeps the file a module, so no `export {}` is added.
	{
		code: 'import type { ReactNode } from "react";\nimport { x } from "y";\ntype Node = ReactNode;',
		errors: [{ messageId: typeNamedImport }],
		filename,
		options: [{ umdGlobal: true }],
		output: 'import { x } from "y";\ntype Node = React.ReactNode;',
	},
	// `export =` also keeps the file a module (and forbids `export {}`).
	{
		code: 'import type { ReactNode } from "react";\ntype Node = ReactNode;\nexport = 1;',
		errors: [{ messageId: typeNamedImport }],
		filename,
		options: [{ umdGlobal: true }],
		output: "type Node = React.ReactNode;\nexport = 1;",
	},
	// A foreign `React` binding shadows the global: report without a fix.
	{
		code: 'import * as React from "some-other-lib";\nimport type { ReactNode } from "react";\ntype Node = ReactNode;',
		errors: [{ messageId: typeNamedImport }],
		filename,
		options: [{ umdGlobal: true }],
		output: null,
	},
	{
		code: 'import type { ReactNode } from "react";\nconst React = 1;\ntype Node = ReactNode;',
		errors: [{ messageId: typeNamedImport }],
		filename,
		options: [{ umdGlobal: true }],
		output: null,
	},
	{
		code: 'import type { ReactNode } from "react";\ntype React = string;\ntype Node = ReactNode;',
		errors: [{ messageId: typeNamedImport }],
		filename,
		options: [{ umdGlobal: true }],
		output: null,
	},
	// An existing namespace import keeps its local name; nothing is inserted.
	{
		code: 'import * as R from "react";\nimport type { ReactNode } from "react";\nlet x: ReactNode;',
		errors: [{ messageId: typeNamedImport }],
		filename,
		options: [{ umdGlobal: true }],
		output: 'import * as R from "react";\nlet x: R.ReactNode;',
	},
	// A named import also used as a value stays; only the type is qualified.
	{
		code: 'import { Component } from "react";\nclass A extends Component {}\nlet x: Component;',
		errors: [{ messageId: typeNamedImport }],
		filename,
		options: [{ umdGlobal: true }],
		output: 'import { Component } from "react";\nclass A extends Component {}\nlet x: React.Component;',
	},
	// Other named specifiers survive; only the redundant one is removed.
	{
		code: 'import { useState, type ReactNode } from "react";\nuseState();\nlet x: ReactNode;',
		errors: [{ messageId: typeNamedImport }],
		filename,
		options: [{ umdGlobal: true }],
		output: 'import { useState } from "react";\nuseState();\nlet x: React.ReactNode;',
	},
	// Multiple references each qualify; the import is removed once.
	{
		code: 'import type { ReactNode } from "react";\nlet a: ReactNode;\nlet b: ReactNode;',
		errors: [{ messageId: typeNamedImport }, { messageId: typeNamedImport }],
		filename,
		options: [{ umdGlobal: true }],
		output: "export {};\nlet a: React.ReactNode;\nlet b: React.ReactNode;",
	},
	// An existing default import keeps its local name.
	{
		code: 'import R, { ReactNode } from "react";\nlet x: ReactNode;',
		errors: [{ messageId: typeNamedImport }],
		filename,
		options: [{ umdGlobal: true }],
		output: 'import R from "react";\nlet x: R.ReactNode;',
	},
	// Runtime direction is unaffected.
	{
		code: 'import React from "react";\nReact.useEffect();',
		errors: [{ messageId: runtimeNamespace }],
		filename,
		options: [{ umdGlobal: true }],
		output: 'import React, { useEffect } from "react";\nuseEffect();',
	},
	// `umdGlobal: false` keeps the default behavior.
	{
		code: 'import type { ReactNode } from "react";\nconst x: ReactNode = null;',
		errors: [{ messageId: typeNamedImport }],
		filename,
		options: [{ umdGlobal: false }],
		output: 'import React from "react";\nconst x: React.ReactNode = null;',
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
