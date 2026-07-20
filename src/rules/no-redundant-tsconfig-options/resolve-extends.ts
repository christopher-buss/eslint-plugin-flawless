import { getStaticJSONValue, parseForESLint } from "jsonc-eslint-parser";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * A single inherited value together with the config file that most locally
 * defined it (used to tell the user which config already sets the option).
 */
export interface InheritedEntry {
	readonly source: string;
	readonly value: unknown;
}

/**
 * The options a tsconfig inherits from everything it `extends`, flattened so the
 * nearest ancestor that defines a key wins. Top-level `include` / `exclude` /
 * `files` replace rather than merge in TypeScript, so each is a single entry
 * rather than a per-key map.
 */
export interface InheritedConfig {
	readonly compilerOptions: Map<string, InheritedEntry>;
	readonly exclude?: InheritedEntry;
	readonly files?: InheritedEntry;
	readonly include?: InheritedEntry;
}

/** The subset of a tsconfig this rule reads. */
interface RawTsconfig {
	compilerOptions?: Record<string, unknown>;
	exclude?: unknown;
	extends?: unknown;
	files?: unknown;
	include?: unknown;
}

const TOP_LEVEL_KEYS = ["include", "exclude", "files"] as const;

/**
 * Resolves one `extends` specifier to an absolute config path, or `undefined`
 * when it cannot be found. Path specifiers resolve against the extending file's
 * directory (appending `.json` or `/tsconfig.json` as TypeScript does); package
 * specifiers go through `require.resolve`, which honours the package `exports`
 * map (so `@scope/pkg/subpath` maps correctly).
 *
 * @param spec - The raw `extends` specifier.
 * @param fromFile - The absolute path of the config doing the extending.
 * @returns The resolved absolute path, or `undefined`.
 */
export function resolveExtendsTarget(spec: string, fromFile: string): string | undefined {
	if (isPathSpecifier(spec)) {
		const base = path.resolve(path.dirname(fromFile), spec);
		if (fileExists(base)) {
			return base;
		}

		if (!base.endsWith(".json") && fileExists(`${base}.json`)) {
			return `${base}.json`;
		}

		const nested = path.join(base, "tsconfig.json");
		return fileExists(nested) ? nested : undefined;
	}

	const require = createRequire(fromFile);
	for (const candidate of [spec, `${spec}.json`, `${spec}/tsconfig.json`]) {
		try {
			return require.resolve(candidate);
		} catch {
			// Try the next fallback; a specifier gated behind an `exports` map
			// under a non-`require` condition is intentionally left unresolved.
		}
	}

	return undefined;
}

/**
 * Builds the config a child inherits from its `extends` targets alone (the child
 * itself excluded). Later targets in an `extends` array override earlier ones,
 * matching TypeScript's precedence.
 *
 * @param childFile - The absolute path of the config being linted.
 * @param extendsField - The child's raw `extends` value (string or array).
 * @returns The inherited config, or `undefined` when nothing resolves.
 */
export function buildInheritedConfig(
	childFile: string,
	extendsField: unknown,
): InheritedConfig | undefined {
	const specs = normalizeExtends(extendsField);
	if (specs.length === 0) {
		return undefined;
	}

	const visited = new Set<string>([childFile]);
	const compilerOptions = new Map<string, InheritedEntry>();
	const result: {
		compilerOptions: Map<string, InheritedEntry>;
		exclude?: InheritedEntry;
		files?: InheritedEntry;
		include?: InheritedEntry;
	} = { compilerOptions };

	let resolvedAny = false;
	for (const spec of specs) {
		const target = resolveExtendsTarget(spec, childFile);
		if (target === undefined) {
			continue;
		}

		resolvedAny = true;
		const parent = flatten(target, visited);
		for (const [key, entry] of parent.compilerOptions) {
			compilerOptions.set(key, entry);
		}

		for (const key of TOP_LEVEL_KEYS) {
			const entry = parent[key];
			if (entry !== undefined) {
				result[key] = entry;
			}
		}
	}

	return resolvedAny ? result : undefined;
}

/**
 * Whether an `extends` specifier is a filesystem path (relative or absolute)
 * rather than a package specifier. Matches TypeScript: a leading `.` or a rooted
 * path is a path; anything else resolves through node module resolution.
 *
 * @param spec - The raw `extends` specifier.
 * @returns True when the specifier should resolve against the filesystem.
 */
function isPathSpecifier(spec: string): boolean {
	return spec.startsWith(".") || path.isAbsolute(spec);
}

function fileExists(candidate: string): boolean {
	try {
		return existsSync(candidate) && statSync(candidate).isFile();
	} catch {
		return false;
	}
}

function normalizeExtends(value: unknown): Array<string> {
	if (typeof value === "string") {
		return [value];
	}

	if (Array.isArray(value)) {
		return value.filter((entry): entry is string => typeof entry === "string");
	}

	return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads and parses a parent tsconfig from disk. Returns `undefined` for any
 * failure — missing file, unreadable, invalid JSONC, or a top level that is not
 * an object — so a broken ancestor never crashes the lint.
 *
 * @param file - The absolute path of the config to read.
 * @returns The parsed config subset, or `undefined`.
 */
function readTsconfig(file: string): RawTsconfig | undefined {
	try {
		const text = readFileSync(file, "utf8");
		const { ast } = parseForESLint(text, {});
		const statement = ast.body.at(0);
		if (statement?.expression.type !== "JSONObjectExpression") {
			return undefined;
		}

		const value = getStaticJSONValue(statement.expression);
		return isRecord(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

function overlay(target: Map<string, InheritedEntry>, options: unknown, source: string): void {
	if (!isRecord(options)) {
		return;
	}

	for (const [key, value] of Object.entries(options)) {
		target.set(key, { source, value });
	}
}

/**
 * Flattens the effective config a file resolves to — its own extends chain,
 * overlaid by its own values (a file's own options win over what it extends).
 * The `visited` set guards against circular `extends`.
 *
 * @param file - The absolute path of the config to flatten.
 * @param visited - Absolute paths already being flattened on this branch.
 * @returns The flattened config, with each entry's `source` naming its definer.
 */
function flatten(file: string, visited: Set<string>): InheritedConfig {
	const compilerOptions = new Map<string, InheritedEntry>();
	const result: {
		compilerOptions: Map<string, InheritedEntry>;
		exclude?: InheritedEntry;
		files?: InheritedEntry;
		include?: InheritedEntry;
	} = { compilerOptions };

	if (visited.has(file)) {
		return result;
	}

	visited.add(file);

	const config = readTsconfig(file);
	if (config === undefined) {
		return result;
	}

	for (const spec of normalizeExtends(config.extends)) {
		const target = resolveExtendsTarget(spec, file);
		if (target === undefined) {
			continue;
		}

		const parent = flatten(target, visited);
		for (const [key, entry] of parent.compilerOptions) {
			compilerOptions.set(key, entry);
		}

		for (const key of TOP_LEVEL_KEYS) {
			const entry = parent[key];
			if (entry !== undefined) {
				result[key] = entry;
			}
		}
	}

	overlay(compilerOptions, config.compilerOptions, file);
	for (const key of TOP_LEVEL_KEYS) {
		if (config[key] !== undefined) {
			result[key] = { source: file, value: config[key] };
		}
	}

	return result;
}
