import tsParser from "@typescript-eslint/parser";

import { Linter } from "eslint";
import path from "node:path";
import ts from "typescript";

/**
 * A fix-safety oracle for `no-redundant-type-annotation`.
 *
 * The rule promises that its fix changes no type, so the promise can be
 * checked directly: type-check the source before and after the fix with the
 * compiler options of the project the file belongs to, and compare. A fix is
 * safe when it adds no diagnostic and every declared variable, class property,
 * function-body parameter, function expression, and call keeps its printed
 * type. The oracle knows nothing about why the rule reports, so it catches a
 * wrong fix the rule's own reasoning cannot see.
 *
 * Many snippets are checked in one program per project, each in a file of its
 * own. Every file is forced to be a module so their declarations stay apart.
 */

/** A snippet of source, and the file whose project it is checked in. */
export interface Snippet {
	readonly name?: string;
	readonly code: string;
	readonly filename: string;
}

/** A snippet and the text the rule's fix turned it into. */
export interface FixedSnippet extends Snippet {
	readonly output: string;
}

/** What a fix must leave alone: a file's errors and the types it declares. */
interface Snapshot {
	readonly diagnostics: ReadonlyArray<string>;
	readonly types: ReadonlyArray<string>;
}

/** A file to hand the compiler, not written to disk. */
interface VirtualFile {
	readonly fileName: string;
	readonly text: string;
}

/** A project's compiler options and the library files parsed for it. */
interface Project {
	readonly options: ts.CompilerOptions;
	readonly sourceFiles: Map<string, ts.SourceFile | undefined>;
}

/** A snippet partway through its fix passes. */
interface FixRun {
	original?: Snapshot;
	readonly snippet: Snippet;
	text: string;
}

// ESLint's own limit on fix passes.
const MAX_FIX_PASSES = 10;

// The global JSX namespace a `.tsx` corpus snippet needs. Declared once per
// program; a `declare global` block in every file would merge its index
// signatures into duplicates.
const JSX_NAMESPACE = `declare namespace JSX {
	interface Element {}
	interface ElementAttributesProperty { props: {} }
	interface ElementChildrenAttribute { children: {} }
	interface IntrinsicElements {
		button: { onClick: (event: { x: number }) => void };
		[name: string]: any;
	}
}
`;

const projects = new Map<string, Project>();

/**
 * Checks that each snippet's fixed output has the types its source had.
 *
 * @param snippets - Sources paired with the output the rule tester produced.
 * @returns One failure per unsafe fix, empty when every fix is safe.
 */
export function checkFixes(snippets: ReadonlyArray<FixedSnippet>): Array<string> {
	const failures: Array<string> = [];
	for (const [tsconfig, group] of groupByTsconfig(snippets)) {
		const pairs = group.map((snippet, index) => {
			return {
				after: virtualName(tsconfig, `after-${index}`, snippet),
				before: virtualName(tsconfig, `before-${index}`, snippet),
				snippet,
			};
		});
		const program = createProgram(
			loadProject(tsconfig),
			pairs.flatMap(({ after, before, snippet }) => {
				return [
					{ fileName: before, text: snippet.code },
					{ fileName: after, text: snippet.output },
				];
			}),
		);
		for (const { after, before, snippet } of pairs) {
			const problems = compareSnapshots(
				takeSnapshot(program, before),
				takeSnapshot(program, after),
			);
			if (problems.length > 0) {
				failures.push(describeFailure(snippet, snippet.output, problems));
			}
		}
	}

	return failures;
}

/**
 * Lints each snippet with a rule, applies its fixes pass by pass the way
 * ESLint does, and checks every pass's output against the source.
 *
 * @param rule - The rule under test, as a plugin would export it.
 * @param snippets - Sources to lint, with no expectation on what is reported.
 * @returns One failure per unsafe or unsettled fix, empty when all are safe.
 */
export function checkRuleFixes(rule: unknown, snippets: ReadonlyArray<Snippet>): Array<string> {
	const failures: Array<string> = [];
	for (const [tsconfig, group] of groupByTsconfig(snippets)) {
		let pending: Array<FixRun> = group.map((snippet) => ({ snippet, text: snippet.code }));
		for (let pass = 0; pass <= MAX_FIX_PASSES && pending.length > 0; pass += 1) {
			pending = runFixPass({ failures, pass, rule, runs: pending, tsconfig });
		}

		for (const { snippet, text } of pending) {
			failures.push(describeFailure(snippet, text, ["fix does not settle"]));
		}
	}

	return failures;
}

/**
 * Loads the compiler options of a tsconfig, forcing every file to be a module.
 *
 * @param tsconfig - Absolute path of the tsconfig to read.
 * @returns The project, cached per tsconfig.
 */
function loadProject(tsconfig: string): Project {
	let project = projects.get(tsconfig);
	if (project === undefined) {
		const parsed = ts.getParsedCommandLineOfConfigFile(
			tsconfig,
			{},
			{
				...ts.sys,
				onUnRecoverableConfigFileDiagnostic(diagnostic) {
					throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
				},
			},
		);
		if (parsed === undefined) {
			throw new Error(`Cannot read ${tsconfig}`);
		}

		project = {
			options: {
				...parsed.options,
				jsx: parsed.options.jsx ?? ts.JsxEmit.Preserve,
				moduleDetection: ts.ModuleDetectionKind.Force,
				noEmit: true,
			},
			sourceFiles: new Map(),
		};
		projects.set(tsconfig, project);
	}

	return project;
}

/**
 * Finds the tsconfig that owns a file.
 *
 * @param filename - Absolute path of a file, which need not exist.
 * @returns The nearest tsconfig at or above the file's directory.
 */
function findTsconfig(filename: string): string {
	const tsconfig = ts.findConfigFile(path.dirname(filename), (fileName) => {
		return ts.sys.fileExists(fileName);
	});
	if (tsconfig === undefined) {
		throw new Error(`No tsconfig owns ${filename}`);
	}

	return path.resolve(tsconfig);
}

/**
 * Groups snippets by the tsconfig that owns them, keeping their order.
 *
 * @template T - The kind of snippet.
 * @param snippets - Snippets from any number of projects.
 * @returns Each tsconfig with its snippets.
 */
function groupByTsconfig<T extends Snippet>(snippets: ReadonlyArray<T>): Map<string, Array<T>> {
	const groups = new Map<string, Array<T>>();
	for (const snippet of snippets) {
		const tsconfig = findTsconfig(snippet.filename);
		const group = groups.get(tsconfig) ?? [];
		group.push(snippet);
		groups.set(tsconfig, group);
	}

	return groups;
}

/**
 * Names a virtual file beside the project's tsconfig.
 *
 * @param tsconfig - The owning tsconfig.
 * @param label - Unique within the program, says what the file holds.
 * @param snippet - The snippet, whose extension the file keeps.
 * @returns An absolute file name no real file uses.
 */
function virtualName(tsconfig: string, label: string, snippet: Snippet): string {
	return path.join(
		path.dirname(tsconfig),
		"__fix-safety__",
		`${label}${path.extname(snippet.filename)}`,
	);
}

/**
 * Normalizes a file name the way the compiler compares them.
 *
 * @param fileName - Any spelling of a path.
 * @returns A key equal for every spelling of the same file.
 */
function toKey(fileName: string): string {
	const normalized = path.resolve(fileName).replaceAll("\\", "/");
	return ts.sys.useCaseSensitiveFileNames ? normalized : normalized.toLowerCase();
}

/**
 * Builds a program over virtual files, reusing the project's parsed library
 * files.
 *
 * @param project - The project whose options to use.
 * @param files - Sources that exist only in memory.
 * @returns A program whose root files are exactly those sources.
 */
function createProgram(project: Project, files: ReadonlyArray<VirtualFile>): ts.Program {
	const texts = new Map(files.map(({ fileName, text }) => [toKey(fileName), text]));
	const disk = ts.createCompilerHost(project.options, true);
	const host: ts.CompilerHost = {
		...disk,
		fileExists(fileName) {
			return texts.has(toKey(fileName)) || disk.fileExists(fileName);
		},
		getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreate) {
			const key = toKey(fileName);
			const text = texts.get(key);
			if (text !== undefined) {
				return ts.createSourceFile(fileName, text, languageVersionOrOptions, true);
			}

			if (!project.sourceFiles.has(key)) {
				project.sourceFiles.set(
					key,
					disk.getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreate),
				);
			}

			return project.sourceFiles.get(key);
		},
		readFile(fileName) {
			return texts.get(toKey(fileName)) ?? disk.readFile(fileName);
		},
	};

	return ts.createProgram(
		files.map(({ fileName }) => fileName),
		project.options,
		host,
	);
}

/**
 * Reports whether a parameter's owner is a function with a body, rather than
 * a signature inside a type.
 *
 * @param node - The parameter's parent.
 * @returns True for a function with a body.
 */
function hasBody(node: ts.Node): boolean {
	return ts.isFunctionLike(node) && "body" in node && node.body !== undefined;
}

/**
 * Records a file's diagnostics and the printed types of what it declares, in
 * document order.
 *
 * @param program - A program that has the file as a root.
 * @param fileName - The virtual file to read.
 * @returns What a safe fix must leave unchanged.
 */
function takeSnapshot(program: ts.Program, fileName: string): Snapshot {
	const sourceFile = program.getSourceFile(fileName);
	if (sourceFile === undefined) {
		throw new Error(`${fileName} is not in the program`);
	}

	const checker = program.getTypeChecker();
	const { composite, declaration } = program.getCompilerOptions();
	const diagnostics = [
		...program.getSyntacticDiagnostics(sourceFile),
		...program.getSemanticDiagnostics(sourceFile),
		...(declaration === true || composite === true
			? program.getDeclarationDiagnostics(sourceFile)
			: []),
	].map((diagnostic) => {
		return `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
	});

	const types: Array<string> = [];
	function record(label: string, node: ts.Node): void {
		const type = checker.typeToString(
			checker.getTypeAtLocation(node),
			undefined,
			ts.TypeFormatFlags.NoTruncation,
		);
		types.push(`${label}: ${type}`);
	}

	function visit(node: ts.Node): void {
		if (
			ts.isVariableDeclaration(node) ||
			ts.isPropertyDeclaration(node) ||
			(ts.isParameter(node) && hasBody(node.parent))
		) {
			record(node.name.getText(sourceFile), node.name);
		} else if (
			ts.isCallExpression(node) ||
			ts.isNewExpression(node) ||
			ts.isTaggedTemplateExpression(node)
		) {
			record("call", node);
		} else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
			record("function", node);
		}

		ts.forEachChild(node, visit);
	}

	visit(sourceFile);

	return { diagnostics, types };
}

/**
 * Lists what a fix changed between two snapshots of the same file.
 *
 * @param before - The snapshot before the fix.
 * @param after - The snapshot after it.
 * @returns One line per new diagnostic or changed type, empty when safe.
 */
function compareSnapshots(before: Snapshot, after: Snapshot): Array<string> {
	const problems: Array<string> = [];
	const remaining = [...before.diagnostics];
	for (const diagnostic of after.diagnostics) {
		const index = remaining.indexOf(diagnostic);
		if (index === -1) {
			problems.push(`new ${diagnostic}`);
		} else {
			remaining.splice(index, 1);
		}
	}

	if (before.types.length !== after.types.length) {
		problems.push(`${before.types.length} typed nodes became ${after.types.length}`);
		return problems;
	}

	for (const [index, type] of before.types.entries()) {
		if (after.types[index] !== type) {
			problems.push(`${type} became ${after.types[index]}`);
		}
	}

	return problems;
}

/**
 * Describes a snippet whose fix changed a type.
 *
 * @param snippet - The snippet that failed.
 * @param output - The source the fix produced.
 * @param problems - Each new diagnostic or changed type.
 * @returns A failure message with the source, the output, and what changed.
 */
function describeFailure(
	snippet: Snippet,
	output: string,
	problems: ReadonlyArray<string>,
): string {
	const project = path.basename(path.dirname(findTsconfig(snippet.filename)));
	return [
		`${snippet.name ?? "case"} (${project})`,
		`code:\n${snippet.code}`,
		`output:\n${output}`,
		...problems,
	].join("\n");
}

/**
 * Applies every non-overlapping fix at once, as one ESLint pass does.
 *
 * Like ESLint, a fix that starts where the previous one ended waits for the
 * next pass.
 *
 * @param text - The source the messages were reported on.
 * @param messages - The lint messages, fixable or not.
 * @returns The fixed source.
 */
function applyFixes(text: string, messages: ReadonlyArray<Linter.LintMessage>): string {
	const fixes = messages
		.map(({ fix }) => fix)
		.filter((fix) => fix !== undefined)
		.sort((left, right) => left.range[0] - right.range[0] || left.range[1] - right.range[1]);

	let output = "";
	let last = Number.NEGATIVE_INFINITY;
	for (const fix of fixes) {
		if (last >= fix.range[0]) {
			continue;
		}

		output += text.slice(Math.max(0, last), fix.range[0]) + fix.text;
		[, last] = fix.range;
	}

	return output + text.slice(Math.max(0, last));
}

/**
 * Runs one fix pass over every snippet still changing.
 *
 * Each snippet's current text is first checked against its original, then
 * linted, and every non-overlapping fix is applied at once.
 *
 * @param options - The pass to run.
 * @param options.failures - Collects a failure per unsafe snippet.
 * @param options.pass - The pass number, counted from zero.
 * @param options.rule - The rule under test.
 * @param options.runs - The snippets the previous pass changed.
 * @param options.tsconfig - The project the snippets belong to.
 * @returns The snippets this pass changed, which need another.
 */
function runFixPass({
	failures,
	pass,
	rule,
	runs,
	tsconfig,
}: {
	failures: Array<string>;
	pass: number;
	rule: unknown;
	runs: ReadonlyArray<FixRun>;
	tsconfig: string;
}): Array<FixRun> {
	const entries = runs.map((run, index) => {
		return { fileName: virtualName(tsconfig, `pass-${pass}-${index}`, run.snippet), run };
	});
	const program = createProgram(loadProject(tsconfig), [
		{
			fileName: path.join(path.dirname(tsconfig), "__fix-safety__", "jsx-namespace.d.ts"),
			text: JSX_NAMESPACE,
		},
		...entries.map(({ fileName, run }) => ({ fileName, text: run.text })),
	]);
	const linter = new Linter({ configType: "flat", cwd: path.dirname(tsconfig) });
	const config: Linter.Config = {
		files: ["**/*.ts", "**/*.tsx"],
		languageOptions: { parser: tsParser, parserOptions: { programs: [program] } },
		plugins: {
			subject: { rules: { rule } } as unknown as NonNullable<
				Linter.Config["plugins"]
			>[string],
		},
		rules: { "subject/rule": "error" },
	};

	const changed: Array<FixRun> = [];
	for (const { fileName, run } of entries) {
		const snapshot = takeSnapshot(program, fileName);
		run.original ??= snapshot;
		const problems = compareSnapshots(run.original, snapshot);
		const messages = problems.length > 0 ? [] : linter.verify(run.text, config, fileName);
		const fatal = messages.find((message) => message.fatal === true);
		if (fatal !== undefined) {
			problems.push(`does not lint: ${fatal.message}`);
		}

		if (problems.length > 0) {
			failures.push(
				describeFailure(run.snippet, run.text, [`after pass ${pass}:`, ...problems]),
			);
			continue;
		}

		const output = applyFixes(run.text, messages);
		if (output !== run.text) {
			run.text = output;
			changed.push(run);
		}
	}

	return changed;
}
