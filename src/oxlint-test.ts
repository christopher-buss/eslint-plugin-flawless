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
}

/**
 * The result of linting a fixture with a single flawless rule under oxlint.
 */
export interface RunOxlintResult {
	/** Diagnostics reported by the rule. */
	readonly diagnostics: Array<OxlintDiagnostic>;
	/** File contents after `oxlint --fix`. */
	readonly fixed: string;
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
 * Lints (and separately fixes) a fixture with one flawless rule using the real
 * oxlint binary and the built `dist/oxlint.mjs` plugin.
 *
 * @param options - The rule, fixture, and rule options to run.
 * @returns The reported diagnostics and the `--fix` output.
 */
export function runOxlint({ code, filename, options, rule }: RunOxlintOptions): RunOxlintResult {
	ensureOxlintPluginBuilt();

	const directory = mkdtempSync(path.join(tmpdir(), "flawless-oxlint-"));
	try {
		const configPath = writeConfig(directory, rule, options);
		const filePath = path.join(directory, filename);
		writeFileSync(filePath, code);

		const stdout = invokeOxlint(["--config", configPath, "-f", "json", filePath], directory);
		const parsed = JSON.parse(stdout) as {
			diagnostics: Array<{ code: string; message: string }>;
		};
		const diagnostics = parsed.diagnostics
			.filter((diagnostic) => diagnostic.code.startsWith("flawless("))
			.map(({ code: diagnosticCode, message }) => ({ code: diagnosticCode, message }));

		invokeOxlint(["--config", configPath, "--fix", filePath], directory);
		const fixed = readFileSync(filePath, "utf8");

		return { diagnostics, fixed };
	} finally {
		rmSync(directory, { force: true, recursive: true });
	}
}

function writeConfig(
	directory: string,
	rule: string,
	options: ReadonlyArray<unknown> | undefined,
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
		}),
	);
	return configPath;
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
