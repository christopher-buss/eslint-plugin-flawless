import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const isWindows = process.platform === "win32";
const rootDirectory = path.resolve(__dirname, "..");
const builtPluginPath = path.resolve(rootDirectory, "dist", "oxlint.mjs");
// oxlint's bin is a Node ESM shim; run it via `node` (no shell) for portability.
const oxlintBin = path.resolve(rootDirectory, "node_modules", "oxlint", "bin", "oxlint");

/**
 * A single oxlint diagnostic, reduced to the fields the tests assert on.
 */
export interface OxlintDiagnostic {
	/** Rule code, e.g. `flawless(purity)`. */
	readonly code: string;
	/** Rendered message with `{{data}}` placeholders interpolated. */
	readonly message: string;
}

/**
 * Options for a single oxlint run.
 */
export interface RunOxlintOptions {
	/** Source code to lint. */
	readonly code: string;
	/** File name (drives the parser: use `.tsx` for JSX). */
	readonly filename: string;
	/** Rule options, appended to `"error"` as `["error", ...options]`. */
	readonly options?: ReadonlyArray<unknown>;
	/** The rule key without the plugin prefix, e.g. `purity`. */
	readonly rule: string;
	/** Shared settings written to the generated `.oxlintrc.json`. */
	readonly settings?: Readonly<Record<string, unknown>>;
}

/**
 * The result of linting a fixture with a single flawless rule under oxlint.
 */
export interface RunOxlintResult {
	/** Diagnostics reported by the rule. */
	readonly diagnostics: Array<OxlintDiagnostic>;
}

/**
 * The result of linting *and* fixing a fixture with a single flawless rule.
 */
export interface RunOxlintFixResult extends RunOxlintResult {
	/** File contents after `oxlint --fix`. */
	readonly fixed: string;
}

/** A fixture directory holding a generated config and the file to lint. */
interface OxlintFixture {
	/** Path of the generated `.oxlintrc.json`. */
	readonly configPath: string;
	/** The temporary directory, used as the oxlint working directory. */
	readonly directory: string;
	/** Path of the fixture file. */
	readonly filePath: string;
}

/**
 * Ensures the oxlint plugin entry has been built. The oxlint suite exercises the
 * shipped `dist/oxlint.mjs` (loaded by oxlint's `jsPlugins`), so a build is
 * required; build once if it is missing.
 */
export function ensureOxlintPluginBuilt(): void {
	if (existsSync(builtPluginPath)) {
		return;
	}

	execFileSync("pnpm", ["build"], { cwd: rootDirectory, shell: isWindows, stdio: "inherit" });
}

/**
 * Lints a fixture with one flawless rule using the real oxlint binary and the
 * built `dist/oxlint.mjs` plugin. One oxlint process per call.
 *
 * @param options - The rule, fixture, and rule options to run.
 * @returns The reported diagnostics.
 */
export function runOxlint(options: RunOxlintOptions): RunOxlintResult {
	return withFixture(options, ({ configPath, directory, filePath }) => {
		return { diagnostics: lint(configPath, filePath, directory) };
	});
}

/**
 * Lints a fixture and then fixes it in a second oxlint process. Two processes
 * are unavoidable: `oxlint --fix` reports only the issues it could *not* fix,
 * so the diagnostics must come from a separate lint run. Prefer
 * {@linkcode runOxlint} when the test does not assert on the fixed output.
 *
 * @param options - The rule, fixture, and rule options to run.
 * @returns The reported diagnostics and the `--fix` output.
 */
export function runOxlintFix(options: RunOxlintOptions): RunOxlintFixResult {
	return withFixture(options, ({ configPath, directory, filePath }) => {
		const diagnostics = lint(configPath, filePath, directory);
		invokeOxlint(["--config", configPath, "--fix", filePath], directory);
		return { diagnostics, fixed: readFileSync(filePath, "utf8") };
	});
}

function writeConfig(
	directory: string,
	rule: string,
	options: ReadonlyArray<unknown> | undefined,
	settings: Readonly<Record<string, unknown>> | undefined,
): string {
	const configPath = path.join(directory, ".oxlintrc.json");
	const entry = options === undefined ? "error" : ["error", ...options];
	writeFileSync(
		configPath,
		JSON.stringify({
			categories: {},
			jsPlugins: [builtPluginPath],
			plugins: [],
			rules: { [`flawless/${rule}`]: entry },
			...(settings === undefined ? {} : { settings }),
		}),
	);
	return configPath;
}

function withFixture<T>(
	{ code, filename, options, rule, settings }: RunOxlintOptions,
	run: (fixture: OxlintFixture) => T,
): T {
	ensureOxlintPluginBuilt();

	const directory = mkdtempSync(path.join(tmpdir(), "flawless-oxlint-"));
	try {
		const configPath = writeConfig(directory, rule, options, settings);
		const filePath = path.join(directory, filename);
		writeFileSync(filePath, code);

		return run({ configPath, directory, filePath });
	} finally {
		rmSync(directory, { force: true, recursive: true });
	}
}

function invokeOxlint(args: Array<string>, cwd: string): string {
	try {
		return execFileSync(process.execPath, [oxlintBin, ...args], { cwd, encoding: "utf8" });
	} catch (err) {
		// oxlint exits non-zero when diagnostics are found; stdout still holds
		// them.
		const { stdout } = err as { stdout?: string };
		if (typeof stdout === "string") {
			return stdout;
		}

		throw err;
	}
}

function lint(configPath: string, filePath: string, cwd: string): Array<OxlintDiagnostic> {
	const stdout = invokeOxlint(["--config", configPath, "-f", "json", filePath], cwd);
	const parsed = JSON.parse(stdout) as {
		diagnostics: Array<{ code?: string; message: string }>;
	};
	// A thrown plugin drops every remaining diagnostic for the file, so the
	// rule under test would look silent instead of broken. Fail loudly.
	const crash = parsed.diagnostics.find(({ message }) =>
		message.includes("Error running JS plugin"),
	);
	if (crash !== undefined) {
		throw new Error(crash.message);
	}

	return parsed.diagnostics
		.filter((diagnostic) => diagnostic.code?.startsWith("flawless(") === true)
		.map(({ code, message }) => ({ code: code ?? "", message }));
}
