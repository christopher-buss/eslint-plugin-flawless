import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

/** The Node `assert` modules, mapped to whether each is a `strict` variant. */
const ASSERT_SOURCES: ReadonlyMap<string, boolean> = new Map([
	["assert", false],
	["assert/strict", true],
	["node:assert", false],
	["node:assert/strict", true],
]);

/** A Node `assert` method imported by name. */
export interface AssertFunctionImport {
	/** The exported name, before any `as` alias. */
	readonly method: string;
	/** Whether the import comes from a `strict` variant of the module. */
	readonly strict: boolean;
}

/** The Node `assert` bindings that a file imports. */
export interface AssertImports {
	/** The local names of `functions`, for a check without a scope lookup. */
	readonly functionNames: ReadonlySet<string>;
	/**
	 * Named method imports (`import { strictEqual } from "node:assert"`),
	 * keyed by variable.
	 */
	readonly functions: ReadonlyMap<TSESLint.Scope.Variable, AssertFunctionImport>;
	/** The local names of `objects`, for a check without a scope lookup. */
	readonly objectNames: ReadonlySet<string>;
	/**
	 * Default and namespace imports (`import assert from "node:assert"`) and
	 * named imports of `strict`, keyed by variable. The value tells whether the
	 * object is a `strict` variant.
	 */
	readonly objects: ReadonlyMap<TSESLint.Scope.Variable, boolean>;
}

/**
 * Finds the Node `assert` imports of a file with one pass over its top-level
 * statements. Type-only imports are skipped.
 *
 * @param sourceCode - The source code of the file.
 * @param methods - The method names to record from named imports.
 * @returns The recorded bindings.
 */
export function scanAssertImports(
	sourceCode: Readonly<TSESLint.SourceCode>,
	methods: ReadonlySet<string>,
): AssertImports {
	const functions = new Map<TSESLint.Scope.Variable, AssertFunctionImport>();
	const functionNames = new Set<string>();
	const objects = new Map<TSESLint.Scope.Variable, boolean>();
	const objectNames = new Set<string>();

	for (const statement of sourceCode.ast.body) {
		if (
			statement.type !== AST_NODE_TYPES.ImportDeclaration ||
			statement.importKind === "type"
		) {
			continue;
		}

		const strict = ASSERT_SOURCES.get(statement.source.value);
		if (strict === undefined) {
			continue;
		}

		for (const specifier of statement.specifiers) {
			const variable = sourceCode.getDeclaredVariables(specifier)[0];
			if (variable === undefined) {
				// No binding to track.
			} else if (specifier.type !== AST_NODE_TYPES.ImportSpecifier) {
				objects.set(variable, strict);
				objectNames.add(variable.name);
			} else if (specifier.importKind !== "type") {
				const method = importName(specifier);
				// `import { strict as assert } from "node:assert"` is the strict
				// `assert` object.
				if (method === "strict") {
					objects.set(variable, true);
					objectNames.add(variable.name);
				} else if (method !== null && methods.has(method)) {
					functions.set(variable, { method, strict });
					functionNames.add(variable.name);
				}
			}
		}
	}

	return { functionNames, functions, objectNames, objects };
}

function importName(specifier: TSESTree.ImportSpecifier): null | string {
	if (specifier.imported.type === AST_NODE_TYPES.Identifier) {
		return specifier.imported.name;
	}

	return typeof specifier.imported.value === "string" ? specifier.imported.value : null;
}
