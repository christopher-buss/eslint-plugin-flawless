import { getStaticJSONValue, parseForESLint } from "jsonc-eslint-parser";
import { readFileSync, statSync } from "node:fs";
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
 * nearest ancestor that defines a key wins. `topLevel` holds `include` /
 * `exclude` / `files`, which replace rather than merge in TypeScript.
 */
export interface InheritedConfig {
	readonly compilerOptions: Map<string, InheritedEntry>;
	readonly topLevel: Map<string, InheritedEntry>;
}

/** The subset of a tsconfig this rule reads. */
interface RawTsconfig {
	compilerOptions?: Record<string, unknown>;
	exclude?: unknown;
	extends?: unknown;
	files?: unknown;
	include?: unknown;
}

/**
 * State threaded through one `buildInheritedConfig` resolution.
 *
 * `stack` is the current recursion path — a file is added while it is being
 * flattened and removed on return, so it guards cycles without deduping a shared
 * ancestor reached through two different `extends` branches (which must each
 * resolve it independently, per TypeScript's precedence). `cache` stores the
 * parse of each file so that independent resolution still reads disk once.
 */
interface ResolveContext {
	readonly cache: Map<string, RawTsconfig | undefined>;
	readonly stack: Set<string>;
}

const TOP_LEVEL_KEYS = ["include", "exclude", "files"] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
		// TypeScript appends `.json` when the path lacks it, and treats a
		// directory as its `tsconfig.json` — it never loads a file that has no
		// extension.
		const candidates = base.endsWith(".json")
			? [base]
			: [`${base}.json`, path.join(base, "tsconfig.json")];
		return candidates.find((candidate) => fileExists(candidate));
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
	// Seed the stack with the child so a parent that extends back into it is
	// treated as a cycle rather than re-linted.
	const context: ResolveContext = { cache: new Map(), stack: new Set([childFile]) };
	const result = emptyConfig();

	let resolvedAny = false;
	for (const spec of normalizeExtends(extendsField)) {
		const target = resolveExtendsTarget(spec, childFile);
		if (target === undefined) {
			continue;
		}

		resolvedAny = true;
		mergeParent(result, flatten(target, context));
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
		return statSync(candidate).isFile();
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

function emptyConfig(): InheritedConfig {
	return { compilerOptions: new Map(), topLevel: new Map() };
}

function mergeInto(target: Map<string, InheritedEntry>, source: Map<string, InheritedEntry>): void {
	for (const [key, entry] of source) {
		target.set(key, entry);
	}
}

function mergeParent(into: InheritedConfig, parent: InheritedConfig): void {
	mergeInto(into.compilerOptions, parent.compilerOptions);
	mergeInto(into.topLevel, parent.topLevel);
}

function parseTsconfig(file: string): RawTsconfig | undefined {
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

/**
 * Reads and parses a parent tsconfig from disk. Returns `undefined` for any
 * failure — missing file, unreadable, invalid JSONC, or a top level that is not
 * an object — so a broken ancestor never crashes the lint.
 *
 * @param file - The absolute path of the config to read.
 * @param cache - Per-resolution parse cache, keyed by absolute path.
 * @returns The parsed config subset, or `undefined`.
 */
function readTsconfig(
	file: string,
	cache: Map<string, RawTsconfig | undefined>,
): RawTsconfig | undefined {
	if (cache.has(file)) {
		return cache.get(file);
	}

	const parsed = parseTsconfig(file);
	cache.set(file, parsed);
	return parsed;
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
 * @param context - The shared cycle stack and parse cache.
 * @returns The flattened config, with each entry's `source` naming its definer.
 */
function flatten(file: string, context: ResolveContext): InheritedConfig {
	const result = emptyConfig();
	if (context.stack.has(file)) {
		return result;
	}

	context.stack.add(file);
	try {
		const config = readTsconfig(file, context.cache);
		if (config === undefined) {
			return result;
		}

		for (const spec of normalizeExtends(config.extends)) {
			const target = resolveExtendsTarget(spec, file);
			if (target !== undefined) {
				mergeParent(result, flatten(target, context));
			}
		}

		overlay(result.compilerOptions, config.compilerOptions, file);
		for (const key of TOP_LEVEL_KEYS) {
			if (config[key] !== undefined) {
				result.topLevel.set(key, { source: file, value: config[key] });
			}
		}

		return result;
	} finally {
		context.stack.delete(file);
	}
}
