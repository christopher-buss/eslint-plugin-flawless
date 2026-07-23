import { beforeAll, describe, expect, it } from "vitest";

import { ensureOxlintPluginBuilt, runOxlint } from "./oxlint-test";

// Integration tests: each of the 12 dual-runtime rules is run through the real
// oxlint binary loading the built `dist/oxlint.mjs` plugin, proving the
// `createOnce` bridge works end-to-end (diagnostics, `{{data}}` interpolation,
// options, and fixes). Rule *semantics* are covered exhaustively by the ESLint
// `RuleTester` specs; this suite verifies the oxlint runtime path per rule.

beforeAll(() => {
	ensureOxlintPluginBuilt();
}, 120_000);

describe("oxlint integration", () => {
	it("arrow-return-style reports and fixes a collapsible block", () => {
		const { diagnostics, fixed } = runOxlint({
			code: "const foo = () => {\n\treturn 'foo';\n};\n",
			filename: "file.ts",
			rule: "arrow-return-style",
		});

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.code).toBe("flawless(arrow-return-style)");
		expect(fixed).toContain("const foo = () => 'foo';");
	});

	it("arrow-return-style consults the oxfmt worker under oxlint", () => {
		// 81 chars > maxLen 80 forces the synckit + oxfmt boundary consult
		// before the explicit conversion is reported.
		const { diagnostics, fixed } = runOxlint({
			code: "const exactly81chars = () => 'this string makes the line exactly eighty-one char'\n",
			filename: "file.ts",
			rule: "arrow-return-style",
		});

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.code).toBe("flawless(arrow-return-style)");
		expect(fixed).toContain("return 'this string makes the line exactly eighty-one char';");
	});

	it("jsx-shorthand-boolean reports and fixes", () => {
		const { diagnostics, fixed } = runOxlint({
			code: "export const A = () => <Foo disabled />;\n",
			filename: "file.tsx",
			rule: "jsx-shorthand-boolean",
		});

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.code).toBe("flawless(jsx-shorthand-boolean)");
		expect(diagnostics[0]?.message).toContain("'disabled'");
		expect(fixed).toContain("disabled={true}");
	});

	it("jsx-shorthand-boolean is silent when a value is present", () => {
		const { diagnostics } = runOxlint({
			code: "export const A = () => <Foo disabled={true} />;\n",
			filename: "file.tsx",
			rule: "jsx-shorthand-boolean",
		});

		expect(diagnostics).toHaveLength(0);
	});

	it("jsx-shorthand-fragment reports and fixes a named fragment", () => {
		const { diagnostics, fixed } = runOxlint({
			code: "export const F = () => <Fragment><Foo /></Fragment>;\n",
			filename: "file.tsx",
			rule: "jsx-shorthand-fragment",
		});

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.code).toBe("flawless(jsx-shorthand-fragment)");
		expect(fixed).toContain("<><Foo /></>");
	});

	it("react-namespace reports and fixes a runtime namespace access", () => {
		const { diagnostics, fixed } = runOxlint({
			code: 'import React from "react";\nReact.useEffect();\n',
			filename: "file.tsx",
			rule: "react-namespace",
		});

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.code).toBe("flawless(react-namespace)");
		expect(diagnostics[0]?.message).toContain("'useEffect'");
		expect(fixed).toContain('import React, { useEffect } from "react";');
		expect(fixed).toContain("\nuseEffect();");
	});

	it("react-namespace reports and fixes a bare named type import", () => {
		const { diagnostics, fixed } = runOxlint({
			code: 'import type { ReactNode } from "react";\nlet x: ReactNode;\n',
			filename: "file.tsx",
			rule: "react-namespace",
		});

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.code).toBe("flawless(react-namespace)");
		expect(fixed).toContain('import React from "react";');
		expect(fixed).toContain("let x: React.ReactNode;");
	});

	it("max-lines-per-function reports a function over the limit", () => {
		const { diagnostics } = runOxlint({
			code: "export function foo() {\n\tconst a = 1;\n\treturn a;\n}\n",
			filename: "file.ts",
			options: [{ max: 2 }],
			rule: "max-lines-per-function",
		});

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.code).toBe("flawless(max-lines-per-function)");
		expect(diagnostics[0]?.message).toContain("Function 'foo' has too many lines (4)");
	});

	it("max-lines-per-function counts the whole node under countFrom: function", () => {
		// A three-line signature: body-only counts 3, the whole node counts 6.
		const code = "export function foo(\n\ta: number,\n\tb: number,\n) {\n\treturn a + b;\n}\n";
		const body = runOxlint({
			code,
			filename: "file.ts",
			options: [{ countFrom: "body", max: 4 }],
			rule: "max-lines-per-function",
		});
		const whole = runOxlint({
			code,
			filename: "file.ts",
			options: [{ countFrom: "function", max: 4 }],
			rule: "max-lines-per-function",
		});

		expect(body.diagnostics).toHaveLength(0);
		expect(whole.diagnostics).toHaveLength(1);
		expect(whole.diagnostics[0]?.message).toContain("too many lines (6)");
	});

	it("prefer-parameter-destructuring reports body destructuring", () => {
		const { diagnostics } = runOxlint({
			code: "export function b(props: { id: number }) {\n\tconst { id } = props;\n\treturn id;\n}\n",
			filename: "file.ts",
			rule: "prefer-parameter-destructuring",
		});

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.code).toBe("flawless(prefer-parameter-destructuring)");
		expect(diagnostics[0]?.message).toContain("'props'");
	});

	it("prefer-destructuring-assignment reports member access on props", () => {
		const { diagnostics } = runOxlint({
			code: "export function C(props) {\n\treturn <div>{props.id}</div>;\n}\n",
			filename: "file.tsx",
			rule: "prefer-destructuring-assignment",
		});

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.code).toBe("flawless(prefer-destructuring-assignment)");
	});

	it("purity reports an impure call during render", () => {
		const { diagnostics } = runOxlint({
			code: "export function D() {\n\tconst v = os.time();\n\treturn <div>{v}</div>;\n}\n",
			filename: "file.tsx",
			rule: "purity",
		});

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.code).toBe("flawless(purity)");
		expect(diagnostics[0]?.message).toContain("'os.time'");
	});

	it("purity honours the `ignore` option", () => {
		const { diagnostics } = runOxlint({
			code: "export function D() {\n\tconst v = os.time();\n\treturn <div>{v}</div>;\n}\n",
			filename: "file.tsx",
			options: [{ ignore: ["os.time"] }],
			rule: "purity",
		});

		expect(diagnostics).toHaveLength(0);
	});

	it("no-export-default-arrow reports and fixes an anonymous default export", () => {
		const { diagnostics, fixed } = runOxlint({
			code: "export default () => 1;\n",
			filename: "file.ts",
			rule: "no-export-default-arrow",
		});

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.code).toBe("flawless(no-export-default-arrow)");
		// The name is derived from the filename, so `context.physicalFilename`
		// resolves under oxlint's runtime too.
		expect(fixed).toContain("const file = () => 1");
		expect(fixed).toContain("export default file");
	});

	it("no-unnecessary-use-memo reports an empty-deps useMemo", () => {
		const { diagnostics } = runOxlint({
			code: 'import { useMemo } from "react";\nexport function D() {\n\tconst m = useMemo(() => 1, []);\n\treturn <div>{m}</div>;\n}\n',
			filename: "file.tsx",
			rule: "no-unnecessary-use-memo",
		});

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.code).toBe("flawless(no-unnecessary-use-memo)");
	});

	it("no-unnecessary-use-callback reports an empty-deps useCallback", () => {
		const { diagnostics } = runOxlint({
			code: 'import { useCallback } from "react";\nexport function D() {\n\tconst cb = useCallback(() => 1, []);\n\treturn <div>{cb}</div>;\n}\n',
			filename: "file.tsx",
			rule: "no-unnecessary-use-callback",
		});

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.code).toBe("flawless(no-unnecessary-use-callback)");
	});

	it("padding-after-expect-assertions reports and fixes a missing blank line", () => {
		const { diagnostics, fixed } = runOxlint({
			code: "it('x', () => {\n\texpect.assertions(1);\n\texpect(1).toBe(1);\n});\n",
			filename: "file.ts",
			rule: "padding-after-expect-assertions",
		});

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.code).toBe("flawless(padding-after-expect-assertions)");
		expect(fixed).toContain("expect.assertions(1);\n\n\texpect(1).toBe(1);");
	});
});
