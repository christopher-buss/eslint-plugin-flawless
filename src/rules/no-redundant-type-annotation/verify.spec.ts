import parser from "@typescript-eslint/parser";

import { Linter } from "eslint";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { regressions } from "./regressions";
import { noRedundantTypeAnnotation } from "./rule";
import { type Candidate, COMPILER_FAILURE, verifyAnnotations } from "./verify";

const directory = path.resolve(__dirname, "../../../fixtures");

/**
 * A real checker over an editor buffer, without writing the source to disk.
 * @param code - The unsaved source text.
 * @param extra - Unsaved dependency files included in the program.
 * @param options - Compiler options for this check.
 * @returns The program, its source, and possible annotation removals.
 */
function project(
	code: string,
	extra: ReadonlyMap<string, string> = new Map(),
	options: ts.CompilerOptions = {},
): {
	candidates: Array<Candidate>;
	program: ts.Program;
	source: ts.SourceFile;
} {
	const filename = path.join(directory, "file.ts").replaceAll("\\", "/");
	const files = new Map(
		[...extra, [filename, code]].map(([name, text]) => [name!.replaceAll("\\", "/"), text!]),
	);
	const compilerOptions: ts.CompilerOptions = {
		module: ts.ModuleKind.NodeNext,
		moduleResolution: ts.ModuleResolutionKind.NodeNext,
		skipLibCheck: true,
		strict: true,
		target: ts.ScriptTarget.ES2022,
		...options,
	};
	const base = ts.createCompilerHost(compilerOptions, true);
	const program = ts.createProgram({
		host: {
			...base,
			fileExists: (name) => files.has(name) || base.fileExists(name),
			getSourceFile: (name, languageVersion, onError, shouldCreate) => {
				const text = files.get(name);
				return text === undefined
					? base.getSourceFile(name, languageVersion, onError, shouldCreate)
					: ts.createSourceFile(name, text, languageVersion, true);
			},
			readFile: (name) => files.get(name) ?? base.readFile(name),
		},
		options: compilerOptions,
		rootNames: [...files.keys()],
	});
	const source = program.getSourceFile(filename)!;
	const candidates: Array<Candidate> = [];
	function visit(node: ts.Node): void {
		if (
			((ts.isVariableDeclaration(node) && node.initializer !== undefined) ||
				(ts.isParameter(node) &&
					(ts.isArrowFunction(node.parent) || ts.isFunctionExpression(node.parent)))) &&
			node.type !== undefined
		) {
			candidates.push({
				owner: node,
				range: [code.lastIndexOf(":", node.type.getStart(source)), node.type.end],
			});
		}

		ts.forEachChild(node, visit);
	}

	visit(source);
	return { candidates, program, source };
}

/**
 * Independently run the compiler on an accepted edit.
 * @param code - The source before any removals.
 * @param removals - Edits accepted by the verifier.
 * @returns Diagnostics from a complete semantic check of the edited file.
 */
function compilerProblems(code: string, removals: ReadonlyArray<Candidate>): ReadonlyArray<string> {
	let modified = code;
	for (const { range } of [...removals].sort((a, b) => b.range[0] - a.range[0])) {
		modified = modified.slice(0, range[0]) + modified.slice(range[1]);
	}

	const { program, source } = project(modified);
	return program.getSemanticDiagnostics(source).map((diagnostic) => {
		return `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
	});
}

describe("annotation verification", () => {
	it.each(regressions)("keeps annotations needed by $name", ({ code }) => {
		const { candidates, program, source } = project(code);
		const verification = verifyAnnotations(program, source, candidates);
		expect(verification.rejected.length).toBeGreaterThan(0);
		// A compiler failure also rejects every candidate. Keep that from
		// passing as a successful rejection on any supported TypeScript.
		expect(verification.rejected.map(({ reason }) => reason)).not.toContainEqual(
			expect.stringContaining(COMPILER_FAILURE),
		);
		expect(compilerProblems(code, verification.accepted)).toStrictEqual([]);
		for (const candidate of verification.accepted) {
			expect(compilerProblems(code, [candidate])).toStrictEqual([]);
		}
	});

	it("checks each editor fix before accepting a combined fix", () => {
		// Both removals together preserve f. Removing only its variable type
		// silently changes the return type, which is shaped by its parameter.
		const code = "const f: (x: string) => string | number = (x: string | number) => x;";
		const { candidates, program, source } = project(code);
		const { accepted, rejected } = verifyAnnotations(program, source, candidates);
		expect(accepted).toStrictEqual([]);
		expect(rejected).toHaveLength(2);
	});

	it("keeps a variable annotation that anchors another removal", () => {
		const code = "const f: (x: string) => string = (x: string) => x;";
		const { candidates, program, source } = project(code);
		const { accepted, rejected } = verifyAnnotations(program, source, candidates);
		expect(accepted).toHaveLength(1);
		expect(ts.isParameter(accepted[0]!.owner)).toBe(true);
		expect(rejected).toHaveLength(1);
		expect(compilerProblems(code, accepted)).toStrictEqual([]);
	});

	it("uses unsaved dependency text from the original program", () => {
		const dependency = path.join(directory, "dependency.ts");
		const { candidates, program, source } = project(
			'import { read } from "./dependency.js"; const value: string = read();',
			new Map([[dependency, "export declare function read(): string;"]]),
		);
		expect(program.getSemanticDiagnostics(source)).toStrictEqual([]);
		expect(verifyAnnotations(program, source, candidates).accepted).toHaveLength(1);
	});

	it("verifies an unsaved file from the parser's project service", () => {
		const linter = new Linter({ configType: "flat" });
		// Keep the variable local: isolatedDeclarations requires annotations
		// on exported variables.
		const code = "declare function read(): string; const value: string = read(); export {};";
		const messages = linter.verify(
			code,
			{
				files: ["**/*.ts"],
				languageOptions: {
					parser,
					parserOptions: { projectService: true, tsconfigRootDir: directory },
				},
				plugins: { flawless: { rules: { redundant: noRedundantTypeAnnotation } } as never },
				rules: { "flawless/redundant": "error" },
			},
			path.join(directory, "file.ts"),
		);
		expect(messages).toHaveLength(1);
		expect(messages[0]?.messageId).toBe("redundant");
		expect(messages[0]?.fix).toBeDefined();
	});

	it("reports candidates past the work limit without a fix", () => {
		const linter = new Linter({ configType: "flat" });
		// Keep the variables local: isolatedDeclarations requires annotations
		// on exported variables.
		const code = `declare function read(): string;\n${Array.from(
			{ length: 15 },
			(_, index) => `const value${index}: string = read();`,
		).join("\n")}\nexport {};`;
		const messages = linter.verify(
			code,
			{
				files: ["**/*.ts"],
				languageOptions: {
					parser,
					parserOptions: { projectService: true, tsconfigRootDir: directory },
				},
				plugins: { flawless: { rules: { redundant: noRedundantTypeAnnotation } } as never },
				rules: { "flawless/redundant": "error" },
			},
			path.join(directory, "file.ts"),
		);
		expect(messages).toHaveLength(15);
		expect(messages.filter(({ fix }) => fix !== undefined)).toHaveLength(10);
	});

	it("distinguishes types that print the same name", () => {
		const code = `
interface Options { a: string }
declare function make(): Options;
function local(): void {
	interface Options { a: string }
	const value: Options = make();
}`;
		const { candidates, program, source } = project(code);
		const { accepted, rejected } = verifyAnnotations(program, source, candidates);
		expect(accepted).toStrictEqual([]);
		expect(rejected[0]?.reason).toContain("changes an observed type");
	});

	it("skips the declaration naming check inside function bodies", () => {
		const dependency = path.join(directory, "dependency.ts");
		const extra = new Map([
			[
				dependency,
				"export interface Hidden { a: string }\nexport declare function make(): Hidden;",
			],
		]);
		const code = `import { make } from "./dependency.js";
export const outer: ReturnType<typeof make> = make();
export function inner(): void {
	const value: ReturnType<typeof make> = make();
	void value;
}`;
		const { candidates, program, source } = project(code, extra, { declaration: true });
		const { accepted, rejected } = verifyAnnotations(program, source, candidates);
		expect(accepted.map(({ owner }) => owner.name.getText(source))).toStrictEqual(["value"]);
		expect(rejected.map(({ candidate }) => candidate.owner.name.getText(source))).toStrictEqual(
			["outer"],
		);
	});

	it("leaves annotations alone when the edit cannot be verified", () => {
		const { candidates, program, source } = project(
			"declare function read(): string; const value: string = read();",
		);
		const candidate = candidates[0]!;
		const { accepted, rejected, unverified } = verifyAnnotations(program, source, [
			{ ...candidate, range: [source.text.length, source.text.length + 1] },
		]);
		expect(accepted).toStrictEqual([]);
		expect(unverified).toStrictEqual([]);
		expect(rejected).toHaveLength(1);
		expect(rejected[0]!.reason).toBe(`${COMPILER_FAILURE}: Invalid annotation range`);
	});

	it("preserves overload order when it changes inference", () => {
		const code = `
declare function read(): { (x: number): string; (x: string): number };
const value: { (x: string): number; (x: number): string } = read();`;
		const { candidates, program, source } = project(code);
		expect(verifyAnnotations(program, source, candidates).accepted).toStrictEqual([]);
	});

	it("ignores ordering differences between ordinary object properties", () => {
		const code =
			"declare function read(): { b: number; a: string }; const value: { a: string; b: number } = read();";
		const { candidates, program, source } = project(code);
		expect(verifyAnnotations(program, source, candidates).accepted).toHaveLength(1);
	});

	it("retains safe annotations after a rejected loop cycle", () => {
		const loop = regressions.find(({ name }) => name === "loop call argument cycle");
		const code = `${loop?.code}\ndeclare function read(): string; const safe: string = read();`;
		const { candidates, program, source } = project(code);
		const { accepted } = verifyAnnotations(program, source, candidates);
		expect(accepted).toHaveLength(1);
		expect(accepted[0]!.owner.name.getText(source)).toBe("safe");
	});

	it("bounds work in files with many candidates", () => {
		const code = `declare function read(): string;\n${Array.from(
			{ length: 40 },
			(_, index) => `const value${index}: string = read();`,
		).join("\n")}`;
		const { candidates, program, source } = project(code);
		const { accepted, rejected, unverified } = verifyAnnotations(program, source, candidates);
		expect(accepted.length).toBeGreaterThan(0);
		expect(rejected).toStrictEqual([]);
		expect(accepted.length + unverified.length).toBe(candidates.length);
		expect(unverified.every(({ reason }) => reason.includes("work limit"))).toBe(true);
		expect(compilerProblems(code, accepted)).toStrictEqual([]);
	});
});
