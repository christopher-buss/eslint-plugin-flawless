import type { ImportBindingDefinition } from "@typescript-eslint/scope-manager";
import { DefinitionType } from "@typescript-eslint/scope-manager";
import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";
import { findVariable } from "@typescript-eslint/utils/ast-utils";

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

/**
 * Resolves the name an identifier refers to, mirroring how eslint-plugin-jest
 * resolves test functions. An unresolved reference is a global (vitest's
 * `globals: true` / jest's injected globals); a named import from one of the
 * test global sources resolves to its imported name (so aliases work); anything
 * bound to a local variable, function, or parameter resolves to `null` and is
 * ignored.
 *
 * @param sourceCode - Provides the scope used to look up the binding.
 * @param identifier - The identifier to resolve.
 * @param sources - The modules whose named exports count as test globals.
 * @returns The resolved name (`expect`/`jest`/...), or `null` when the
 *   identifier is a local binding rather than a test global or a test framework
 *   import.
 */
export function resolveTestGlobalName(
	sourceCode: Readonly<TSESLint.SourceCode>,
	identifier: TSESTree.Identifier,
	sources: ReadonlySet<string>,
): null | string {
	const variable = findVariable(sourceCode.getScope(identifier), identifier);
	if (variable === null) {
		return identifier.name;
	}

	const definition = variable.defs.at(0);
	if (definition === undefined) {
		return identifier.name;
	}

	if (definition.type !== DefinitionType.ImportBinding) {
		return null;
	}

	const importDefinition: ImportBindingDefinition = definition;
	const declaration = importDefinition.parent;
	const source =
		declaration.type === AST_NODE_TYPES.ImportDeclaration && declaration.source.value;
	if (source === false || !sources.has(source)) {
		return null;
	}

	const { node } = importDefinition;
	if (
		node.type === AST_NODE_TYPES.ImportSpecifier &&
		node.imported.type === AST_NODE_TYPES.Identifier
	) {
		return node.imported.name;
	}

	return null;
}

/**
 * Determines whether an identifier is a named import from one of the test
 * global sources, as opposed to an unresolved global of the same name. Bun's
 * `mock`/`spyOn` are bare functions whose names are common enough that only a
 * real import should be treated as the test framework's.
 *
 * @param sourceCode - Provides the scope used to look up the binding.
 * @param identifier - The identifier to inspect.
 * @param sources - The modules whose named exports count as test globals.
 * @returns The imported name when the identifier is such an import, else `null`.
 */
export function resolveImportedTestGlobalName(
	sourceCode: Readonly<TSESLint.SourceCode>,
	identifier: TSESTree.Identifier,
	sources: ReadonlySet<string>,
): null | string {
	const variable = findVariable(sourceCode.getScope(identifier), identifier);
	if (variable?.defs.at(0) === undefined) {
		return null;
	}

	return resolveTestGlobalName(sourceCode, identifier, sources);
}
