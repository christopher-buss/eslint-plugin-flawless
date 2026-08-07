import type { TSESLint } from "@typescript-eslint/utils";

/**
 * The modules whose named exports are treated as test globals when
 * `settings.jest.globalPackage` is not configured.
 */
const DEFAULT_SOURCES: ReadonlySet<string> = new Set(["@jest/globals", "bun:test", "vitest"]);

/**
 * Resolves the modules an imported `expect` (or any other test global) may come
 * from, honouring `eslint-plugin-jest`'s `settings.jest.globalPackage`. The
 * setting names the single package the globals are imported from, so a project
 * on a re-export such as `"@rbxts/jest-globals"` is linted like a plain Jest
 * one; as in `eslint-plugin-jest`, it *replaces* the defaults rather than
 * adding to them. A non-string (or empty) value is ignored, keeping a
 * mis-typed setting from silently disabling every rule that reads it.
 *
 * The settings of a file are only available once linting of that file starts,
 * so a `createOnce` rule must call this from its `before` hook or a visitor,
 * never from the `createOnce` body.
 *
 * @param settings - The shared settings of the file being linted.
 * @returns The accepted module specifiers.
 */
export function getTestGlobalSources({
	jest,
}: Readonly<TSESLint.SharedConfigurationSettings>): ReadonlySet<string> {
	if (typeof jest !== "object" || jest === null) {
		return DEFAULT_SOURCES;
	}

	const { globalPackage } = jest as { globalPackage?: unknown };
	if (typeof globalPackage !== "string" || globalPackage.length === 0) {
		return DEFAULT_SOURCES;
	}

	return new Set([globalPackage]);
}
