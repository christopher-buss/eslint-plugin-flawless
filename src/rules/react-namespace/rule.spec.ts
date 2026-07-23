import type { InvalidTestCase, ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { reactNamespace, RULE_NAME } from "./rule";

const runtimeNamespace = "runtimeNamespace";
const typeNamedImport = "typeNamedImport";
const filename = "file.tsx";

// The `@rbxts/react` source exercises the `react-x` `importSource` setting; every
// case runs once against the default `"react"` and once against `"@rbxts/react"`.
const rbx = { "react-x": { importSource: "@rbxts/react" } } as const;

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
