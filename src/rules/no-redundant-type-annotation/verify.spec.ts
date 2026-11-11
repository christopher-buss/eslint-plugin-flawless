import parser from "@typescript-eslint/parser";

import { Linter } from "eslint";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { regressions } from "./regressions";
import { noRedundantTypeAnnotation } from "./rule";
import { type Candidate, COMPILER_FAILURE, FOREIGN_COMPILER, verifyAnnotations } from "./verify";

const directory = path.resolve(__dirname, "../../../fixtures");

// cspell:ignore tsserverlibrary

// Before TypeScript 5.3, the parser's project service loads
// `typescript/lib/tsserverlibrary`, a second copy of the compiler. The rule
// then reports candidates without verifying them, so they carry no fix.
const [major = 0, minor = 0] = ts.versionMajorMinor.split(".").map(Number);
const projectServiceSharesCompiler = major > 5 || (major === 5 && minor >= 3);

// Before TypeScript 5.2, a condition alias does not narrow `this`, so that
// annotation is not needed there.
const aliasesThis = major > 5 || (major === 5 && minor >= 2);
// Before TypeScript 6.0, an annotated `function` expression callback does not
// fix a sibling's inference, so the removal does not change the call's type.
const functionsFixInference = major >= 6;
const functionCallbackKept = functionsFixInference ? 0 : 1;
const verifiedRegressions = regressions.filter(
	({ name }) => aliasesThis || name !== "aliased condition of this",
);

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
	it.each(verifiedRegressions)("keeps annotations needed by $name", ({ code }) => {
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

	it("resolves a package import with the import condition of the file", () => {
		// The package has other declarations for `require`. A removal is safe
		// only when each speculative program resolves the same ones.
		const { candidates, program, source } = project(
			'import { createSyncFn } from "synckit"; const make: typeof createSyncFn = createSyncFn;',
		);
		expect(program.getSemanticDiagnostics(source)).toStrictEqual([]);
		expect(verifyAnnotations(program, source, candidates).accepted).toHaveLength(1);
	});

	it("resolves package imports when the program has no resolution cache", () => {
		const { candidates, program, source } = project(
			'import { createSyncFn } from "synckit"; const make: typeof createSyncFn = createSyncFn;',
		);
		// The resolution cache of a program is internal to the compiler.
		const bare = Object.assign(Object.create(program) as ts.Program, {
			getModuleResolutionCache: undefined,
		});
		expect(verifyAnnotations(bare, source, candidates).accepted).toHaveLength(1);
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
		expect(messages[0]?.fix !== undefined).toBe(projectServiceSharesCompiler);
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
		expect(messages.filter(({ fix }) => fix !== undefined)).toHaveLength(
			projectServiceSharesCompiler ? 10 : 0,
		);
	});

	it("finds a nested use after an earlier removal moves it", () => {
		const code = `declare function read(): string;
const value: string = read();
function outer(): void {
	if (value) {
		const inner = (): number => [value].map((item) => item.length)[0]!;
		void inner;
	}
}`;
		const { candidates, program, source } = project(code);
		const { accepted, rejected } = verifyAnnotations(program, source, candidates);
		expect(rejected).toStrictEqual([]);
		expect(accepted.map(({ owner }) => owner.name!.getText(source))).toStrictEqual(["value"]);
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
		expect(accepted.map(({ owner }) => owner.name!.getText(source))).toStrictEqual(["value"]);
		expect(
			rejected.map(({ candidate }) => candidate.owner.name!.getText(source)),
		).toStrictEqual(["outer"]);
	});

	it("skips the declaration naming check inside static blocks", () => {
		const dependency = path.join(directory, "dependency.ts");
		const extra = new Map([
			[
				dependency,
				"export interface Hidden { a: string }\nexport declare function make(): Hidden;",
			],
		]);
		const code = `import { make } from "./dependency.js";
export class C {
	static {
		const value: ReturnType<typeof make> = make();
		void value;
	}
}`;
		const { candidates, program, source } = project(code, extra, { declaration: true });
		const { accepted } = verifyAnnotations(program, source, candidates);
		expect(accepted.map(({ owner }) => owner.name!.getText(source))).toStrictEqual(["value"]);
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

	it("ignores union member order, which follows each checker's query history", () => {
		const code = 'declare function read(): "b" | "a";\nconst value: "a" | "b" = read();';
		const { candidates, program, source } = project(code);
		expect(verifyAnnotations(program, source, candidates).accepted).toHaveLength(1);
	});

	it("rejects every independent failure in one combined check", () => {
		const code = `declare function json(): any;
declare function read(): string;
const first: string = json();
const kept: string = read();
const second: string = json();`;
		const { candidates, program, source } = project(code);
		const { accepted, rejected } = verifyAnnotations(program, source, candidates);
		expect(accepted.map(({ owner }) => owner.name!.getText(source))).toStrictEqual(["kept"]);
		expect(
			rejected.map(({ candidate }) => candidate.owner.name!.getText(source)),
		).toStrictEqual(["first", "second"]);
		expect(compilerProblems(code, accepted)).toStrictEqual([]);
	});

	it("couples a const with the uses that its condition narrows", () => {
		// Only the removal of isNum narrows v in the second block. The
		// narrowing of ok observes that use too, so the two are coupled.
		const code = `declare const v: string | number;
const ok: boolean = typeof v === "string";
if (ok) {}
const isNum: boolean = typeof v === "number";
if (isNum) { console.log(v); }`;
		const { candidates, program, source } = project(code);
		const { accepted, rejected } = verifyAnnotations(program, source, candidates);
		expect(accepted.map(({ owner }) => owner.name!.getText(source))).toStrictEqual(["ok"]);
		expect(
			rejected.map(({ candidate }) => candidate.owner.name!.getText(source)),
		).toStrictEqual(["isNum"]);
	});

	it("checks parameters that share generic inference one at a time", () => {
		const code = `declare function pair<T>(handlers: { make: (value: T) => T; use: (value: T) => void }): T;
pair({ make: (value: string) => value, use: (value: string) => {} });`;
		const { candidates, program, source } = project(code);
		const { accepted } = verifyAnnotations(program, source, candidates);
		for (const candidate of accepted) {
			expect(compilerProblems(code, [candidate])).toStrictEqual([]);
		}

		expect(compilerProblems(code, accepted)).toStrictEqual([]);
	});

	it("ignores the contextual this an arrow callback gains", () => {
		const code = `declare const list: Array<string>;
const flat = list.flatMap((item: string) => [item]);`;
		const { candidates, program, source } = project(code);
		expect(verifyAnnotations(program, source, candidates).accepted).toHaveLength(1);
	});

	it("keeps an arrow annotation when the contextual this escapes", () => {
		const code = `declare function wrap<F extends (this: Date, item: string) => number>(callback: F): F;
const read = wrap((item: string) => item.length);`;
		const { candidates, program, source } = project(code);
		expect(verifyAnnotations(program, source, candidates).accepted).toStrictEqual([]);
	});

	it("accepts sibling arrow callbacks that both gain a contextual this", () => {
		const code = `declare function pair<T = undefined>(a: (this: T, x: string) => void, b: (this: T, y: string) => void): void;
pair((x: string) => {}, (y: string) => {});`;
		const { candidates, program, source } = project(code);
		const { accepted } = verifyAnnotations(program, source, candidates);
		expect(accepted).toHaveLength(2);
		expect(compilerProblems(code, accepted)).toStrictEqual([]);
	});

	it("keeps a function callback annotation that fixes a sibling's inference", () => {
		const code = `declare function pipe<A>(g: (a: A) => void, f: (x: number) => A): A;
const piped = pipe(function (a) {}, function (x: number) { return x; });`;
		const { candidates, program, source } = project(code);
		expect(verifyAnnotations(program, source, candidates).accepted).toHaveLength(
			functionCallbackKept,
		);
	});

	it("keeps a function callback annotation that picks a generic overload", () => {
		const code = `declare function pipe<A>(g: (a: A) => void, f: (x: number) => A): A;
declare function pipe(g: (a: string) => void, f: (x: number) => string, z: 1): 0;
const piped = pipe(function (a) {}, function (x: number) { return x; });`;
		const { candidates, program, source } = project(code);
		expect(verifyAnnotations(program, source, candidates).accepted).toHaveLength(
			functionCallbackKept,
		);
	});

	it("ignores the contextual this of a parenthesized arrow callback", () => {
		const code = `declare const list: Array<string>;
const flat = list.flatMap(((item: string) => [item]));`;
		const { candidates, program, source } = project(code);
		expect(verifyAnnotations(program, source, candidates).accepted).toHaveLength(1);
	});

	it("does not verify a source from another copy of TypeScript", () => {
		const { candidates, program, source } = project(
			"declare function read(): string; const value: string = read();",
		);
		// Another compiler copy builds nodes with its own constructors.
		class ForeignSourceFile {}

		const foreign = Object.assign(new ForeignSourceFile(), source);
		const { accepted, rejected, unverified } = verifyAnnotations(program, foreign, candidates);
		expect(accepted).toStrictEqual([]);
		expect(rejected).toStrictEqual([]);
		expect(unverified.map(({ reason }) => reason)).toStrictEqual([FOREIGN_COMPILER]);
	});

	it("retains safe annotations after a rejected loop cycle", () => {
		const loop = regressions.find(({ name }) => name === "loop call argument cycle");
		const code = `${loop?.code}\ndeclare function read(): string; const safe: string = read();`;
		const { candidates, program, source } = project(code);
		const { accepted } = verifyAnnotations(program, source, candidates);
		expect(accepted).toHaveLength(1);
		expect(accepted[0]!.owner.name!.getText(source)).toBe("safe");
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

/**
 * Like `project`, with function return types as the only candidates.
 * @param code - The unsaved source text.
 * @returns The program, its source, and the return type removals.
 */
function returnProject(code: string): ReturnType<typeof project> {
	const result = project(code);
	const candidates: Array<Candidate> = [];
	function visit(node: ts.Node): void {
		if (
			(ts.isFunctionDeclaration(node) ||
				ts.isFunctionExpression(node) ||
				ts.isArrowFunction(node) ||
				ts.isMethodDeclaration(node)) &&
			node.type !== undefined
		) {
			candidates.push({
				owner: node,
				range: [code.lastIndexOf(":", node.type.getStart(result.source)), node.type.end],
			});
		}

		ts.forEachChild(node, visit);
	}

	visit(result.source);
	return { ...result, candidates };
}

describe("return type verification", () => {
	it.each([
		[
			"a function declaration",
			"const kinds = new Set<string>();\nfunction getKinds(): Set<string> { return kinds; }",
		],
		[
			"an async function",
			"const kinds = new Set<string>();\nasync function load(): Promise<Set<string>> { return kinds; }",
		],
		[
			"a class method",
			"const kinds = new Set<string>();\nclass Store { read(): Set<string> { return kinds; } }",
		],
		["a body with no value", "declare function log(): void;\nfunction run(): void { log(); }"],
	])("accepts %s", (_, code) => {
		const { candidates, program, source } = returnProject(code);
		const { accepted } = verifyAnnotations(program, source, candidates);
		expect(accepted).toHaveLength(1);
		expect(compilerProblems(code, accepted)).toStrictEqual([]);
	});

	it.each([
		["a widened literal", 'const lit = (): "a" => "a";'],
		["a body with no value as `undefined`", "const none = (): undefined => {};"],
		["a contextually typed `new`", "const empty = (): Set<string> => new Set();"],
		["a callback that sets `map`'s type", "const out = [1].map((x): string | number => x);"],
		["self recursion", "const visit = (n: number): boolean => (n > 0 ? visit(n - 1) : true);"],
	])("rejects %s", (_, code) => {
		const { candidates, program, source } = returnProject(code);
		const { accepted, rejected } = verifyAnnotations(program, source, candidates);
		expect(accepted).toStrictEqual([]);
		expect(rejected).toHaveLength(1);
	});

	it("never accepts both halves of a mutual recursion", () => {
		const code = `const isEven = (n: number): boolean => n === 0 || isOdd(n - 1);
const isOdd = (n: number): boolean => n !== 0 && isEven(n - 1);`;
		const { candidates, program, source } = returnProject(code);
		const { accepted } = verifyAnnotations(program, source, candidates);
		expect(accepted.length).toBeLessThan(2);
		expect(compilerProblems(code, accepted)).toStrictEqual([]);
	});

	it("checks a return type and a parameter of one function together", () => {
		const code = "const read: (x: string) => string = (x: string): string => x;";
		const { candidates, program, source } = returnProject(code);
		const [returned] = candidates;
		const owner = returned?.owner;
		const parameter =
			owner !== undefined && ts.isArrowFunction(owner) ? owner.parameters[0] : undefined;
		const parameterType = parameter?.type;
		expect(parameterType).toBeDefined();

		const { accepted } = verifyAnnotations(program, source, [
			...candidates,
			{
				owner: parameter!,
				range: [code.lastIndexOf(":", parameterType!.getStart(source)), parameterType!.end],
			},
		]);
		expect(accepted).toHaveLength(2);
		expect(compilerProblems(code, accepted)).toStrictEqual([]);
	});
});
