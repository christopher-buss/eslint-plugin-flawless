import { Linter, SourceCode } from "eslint";
import { withCodSpeed } from "@codspeed/tinybench-plugin";
import tsParser from "@typescript-eslint/parser";

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSyncFn } from "synckit";
import { Bench } from "tinybench";
import ts from "typescript";

import builtPlugin from "../dist/index.mjs";
import type { FormatRequest, FormatResponse } from "../src/rules/arrow-return-style/worker";
import { COARSE } from "./coarse";
import { typedParserOptions } from "./eslint.config.mjs";

// CodSpeed trial (see benchmark/README.md). Each task times one rule linting
// one fixture, parse excluded: a `beforeEach` hook parses a fresh SourceCode
// (and, for typed subjects, a fresh program and type checker) outside the
// timed function, which only calls `linter.verify`. Under CodSpeed the plugin
// runs hooks outside measurement; locally it falls back to plain tinybench.
//
// Runs against the built plugin: `pnpm bench:codspeed` builds first.

const HERE = path.dirname(fileURLToPath(import.meta.url));

interface Subject {
	expectedReports?: number;
	label: string;
	options?: Array<unknown>;
	ruleId: string;
	testPath: string;
}

function fromCoarse(ruleId: string): Subject {
	const entry = COARSE.find((candidate) => candidate.ruleId === ruleId);
	if (entry === undefined) {
		throw new Error(`No COARSE entry for ${ruleId}`);
	}

	return { ...entry, label: "coarse" };
}

const SUBJECTS: Array<Subject> = [
	fromCoarse("naming-convention"),
	fromCoarse("no-ignored-return"),
	{
		expectedReports: 24,
		label: "realistic, pure",
		options: [{ useOxfmt: false }],
		ruleId: "arrow-return-style",
		testPath: "./cases/realistic.ts",
	},
	{
		// The rule caches oxfmt verdicts per module and the report check below
		// fills that cache, so timed runs measure the warm path. The worker
		// itself is probed separately before timing.
		expectedReports: 40,
		label: "over-limit distinct, oxfmt warm cache",
		options: [{ useOxfmt: true }],
		ruleId: "arrow-return-style",
		testPath: "./cases/over-limit-distinct.ts",
	},
];

/** A compiler program over the typed project; `previous` reuses its parsed files. */
function typedProgram(filename: string, previous?: ts.Program): ts.Program {
	const parsed = ts.getParsedCommandLineOfConfigFile(
		path.resolve(typedParserOptions.tsconfigRootDir, typedParserOptions.project),
		{},
		{
			...ts.sys,
			onUnRecoverableConfigFileDiagnostic(diagnostic) {
				throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
			},
		},
	);
	if (parsed === undefined) {
		throw new Error("Cannot read the typed benchmark project");
	}

	return ts.createProgram([filename], parsed.options, undefined, previous);
}

interface Prepared {
	config: Linter.Config;
	filename: string;
	parse: () => SourceCode;
	ruleKey: string;
	subject: Subject;
}

function prepare(subject: Subject): Prepared {
	const filename = path.resolve(HERE, subject.testPath);
	const code = readFileSync(filename, "utf8");
	const isTyped = subject.testPath.startsWith("./cases/typed/");
	const ruleKey = `flawless/${subject.ruleId}`;
	let program: ts.Program | undefined;

	// A new Program has a new type checker, so type caches never carry over
	// between iterations; reusing the previous program only skips re-reading
	// lib and fixture files.
	function parse(): SourceCode {
		if (isTyped) {
			program = typedProgram(filename, program);
		}

		const { ast, scopeManager, services, visitorKeys } = tsParser.parseForESLint(code, {
			comment: true,
			ecmaFeatures: { jsx: path.extname(filename) === ".tsx" },
			ecmaVersion: "latest",
			filePath: filename,
			loc: true,
			programs: program === undefined ? undefined : [program],
			range: true,
			sourceType: "module",
			tokens: true,
		});
		return new SourceCode({
			ast: ast as SourceCode.Program,
			parserServices: services,
			scopeManager: scopeManager as SourceCode.Config["scopeManager"],
			text: code,
			visitorKeys,
		});
	}

	const config: Linter.Config = {
		files: ["**/*.ts", "**/*.tsx"],
		languageOptions: { parser: tsParser },
		plugins: { flawless: builtPlugin },
		rules: { [ruleKey]: ["error", ...(subject.options ?? [])] },
	};

	return { config, filename, parse, ruleKey, subject };
}

const linter = new Linter({ configType: "flat" });
const prepared = SUBJECTS.map(prepare);

// Fail before timing if a subject stops reporting, so the bench never times a
// rule that does nothing (e.g. a typed rule without types, or a dead worker).
for (const { config, filename, parse, ruleKey, subject } of prepared) {
	const messages = linter.verify(parse(), config, filename);
	const fatal = messages.find((message) => message.fatal === true);
	if (fatal !== undefined) {
		throw new Error(`${subject.ruleId}: ${fatal.message}`);
	}

	const reports = messages.filter((message) => message.ruleId === ruleKey).length;
	const expected = subject.expectedReports;
	if (expected === undefined ? reports === 0 : reports !== expected) {
		throw new Error(
			`${subject.ruleId} (${subject.label}): expected ${expected ?? "> 0"} reports, received ${reports}`,
		);
	}

	console.log(`${subject.ruleId} (${subject.label}): ${reports} reports`);
}

// The rule treats a failed oxfmt call as "no verdict", and the over-limit
// fixture reports the same count either way, so probe the built worker
// directly: under Valgrind the NAPI module in a worker thread must still load.
const formatSync = createSyncFn<(requests: Array<FormatRequest>) => Array<FormatResponse>>(
	path.resolve(HERE, "../dist/rules/arrow-return-style/worker.mjs"),
	{ timeout: 15_000 },
);
const [probe] = formatSync([
	{ arrowIndex: 0, code: "const f = () => 1;\n", printWidth: 80, tabWidth: 4 },
]);
if (probe === undefined || probe.lineText === null) {
	throw new Error("oxfmt worker returned no verdict");
}

const bench = withCodSpeed(new Bench({ iterations: 20, time: 500 }));

for (const { config, filename, parse, subject } of prepared) {
	let sourceCode: SourceCode | undefined;
	bench.add(
		`${subject.ruleId}: ${subject.label}`,
		() => {
			if (sourceCode === undefined) {
				throw new Error("beforeEach did not run");
			}

			linter.verify(sourceCode, config, filename);
		},
		{
			afterEach() {
				sourceCode = undefined;
			},
			beforeEach() {
				sourceCode = parse();
			},
		},
	);
}

await bench.run();
console.table(bench.table());
