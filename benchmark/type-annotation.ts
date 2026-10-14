import parser from "@typescript-eslint/parser";
import { Linter } from "eslint";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import ts from "typescript";

import { noRedundantTypeAnnotation } from "../src/rules/no-redundant-type-annotation/rule";

// Real-project profiling complements the synthetic typed fixtures in config.ts.
// This measures the complete rule using ESLint's rule-only timings.
// Usage: tsx benchmark/type-annotation.ts <tsconfig> [baseline-rule.ts]
//        tsx benchmark/type-annotation.ts --scaling
const [projectPath, baselinePath] = process.argv.slice(2);
const rule =
	baselinePath === undefined
		? noRedundantTypeAnnotation
		: (await import(pathToFileURL(path.resolve(baselinePath)).href)).noRedundantTypeAnnotation;

function measure(
	program: ts.Program,
	files: ReadonlyArray<ts.SourceFile>,
	directory: string,
): void {
	const linter = new Linter({ configType: "flat", cwd: directory });
	const config: Linter.Config = {
		files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
		languageOptions: { parser, parserOptions: { programs: [program] } },
		linterOptions: { reportUnusedDisableDirectives: "off" },
		plugins: { flawless: { rules: { redundant: rule } } as never },
		rules: { "flawless/redundant": "error" },
	};
	let reports = 0;
	let ruleMs = 0;
	const slow: Array<{ file: string; milliseconds: number; reports: number }> = [];
	const memoryBefore = process.memoryUsage();
	const start = performance.now();
	for (const source of files) {
		const { messages } = linter.verifyAndFix(source.text, config, {
			allowInlineConfig: false,
			filename: source.fileName,
			fix: false,
			stats: true,
		});
		const fatal = messages.find((message) => message.fatal === true || message.ruleId === null);
		if (fatal !== undefined) {
			throw new Error(`${source.fileName}: ${fatal.message}`);
		}
		const milliseconds = linter.getTimes().passes[0]?.rules?.["flawless/redundant"]?.total ?? 0;
		const count = messages.filter((message) => message.ruleId === "flawless/redundant").length;
		reports += count;
		ruleMs += milliseconds;
		if (milliseconds >= 5) {
			slow.push({ file: source.fileName, milliseconds, reports: count });
		}
	}
	const memoryAfter = process.memoryUsage();
	console.log(
		JSON.stringify(
			{
				files: files.length,
				heapBeforeMiB: memoryBefore.heapUsed / 1024 / 1024,
				heapAfterMiB: memoryAfter.heapUsed / 1024 / 1024,
				rssAfterMiB: memoryAfter.rss / 1024 / 1024,
				lintMs: performance.now() - start,
				reports,
				ruleMs,
				slow,
			},
			null,
			2,
		),
	);
}

if (projectPath === "--scaling") {
	for (const copies of [1, 2, 10, 40, 128]) {
		const filename = path.resolve("fixtures/file.ts");
		const code =
			"declare function read(): string;\n" +
			Array.from(
				{ length: copies },
				(_, index) =>
					`export function sample${index}() { const value: string = read(); return value; }`,
			).join("\n");
		const options: ts.CompilerOptions = { strict: true, target: ts.ScriptTarget.ES2022 };
		const host = ts.createCompilerHost(options, true);
		const original = host.getSourceFile;
		host.getSourceFile = (name, languageVersion, onError, shouldCreate) =>
			path.resolve(name) === filename
				? ts.createSourceFile(name, code, languageVersion, true)
				: original(name, languageVersion, onError, shouldCreate);
		const program = ts.createProgram([filename], options, host);
		console.log(`Candidates: ${copies}`);
		measure(program, [program.getSourceFile(filename)!], process.cwd());
	}
} else {
	if (projectPath === undefined) {
		throw new Error("Pass a tsconfig path or --scaling");
	}
	const configPath = path.resolve(projectPath);
	const parsed = ts.getParsedCommandLineOfConfigFile(
		configPath,
		{},
		{
			...ts.sys,
			onUnRecoverableConfigFileDiagnostic(diagnostic) {
				throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
			},
		},
	);
	if (parsed === undefined) {
		throw new Error(`Cannot read ${configPath}`);
	}
	const start = performance.now();
	const program = ts.createProgram({
		rootNames: parsed.fileNames,
		options: parsed.options,
		projectReferences: parsed.projectReferences,
	});
	const rootNames = new Set(parsed.fileNames.map((name) => path.resolve(name)));
	const files = program
		.getSourceFiles()
		.filter(
			(source) =>
				!source.isDeclarationFile &&
				/\.(?:[cm]?ts|tsx)$/u.test(source.fileName) &&
				rootNames.has(path.resolve(source.fileName)),
		);
	console.log(
		`TS ${ts.version}; program ${Math.round(performance.now() - start)} ms; ${baselinePath === undefined ? "verified" : "baseline"}`,
	);
	measure(program, files, path.dirname(configPath));
}
