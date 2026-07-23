import type { TSESLint, TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES } from "@typescript-eslint/utils";

/** The kind of binding an identifier resolves to within a React import. */
export type ReactImportKind = "named" | "namespace";

/** The inputs needed to ensure a named value import exists. */
export interface EnsureNamedValueImportParameters {
	readonly name: string;
	readonly declarations: Array<TSESTree.ImportDeclaration>;
	readonly importSource: string;
	readonly program: TSESTree.Program;
}

/** Matches a bare npm scope (`@rbxts`) with no package segment. */
const SCOPE_PATTERN = /^@[^/]+$/;

/**
 * Whether a module specifier refers to the configured React package. Matches the
 * exact package or any subpath (`@rbxts/react` and `@rbxts/react/jsx-runtime`),
 * but never a sibling package (`@rbxts/react-roblox`), because the `/` boundary
 * excludes it.
 *
 * @param value - The `source.value` of an import declaration.
 * @param importSource - The configured React import source.
 * @returns True when the specifier resolves to the React package.
 */
export function matchesSource(value: string, importSource: string): boolean {
	const reactPackage = resolveReactPackage(importSource);
	return value === reactPackage || value.startsWith(`${reactPackage}/`);
}

/**
 * Collects the import declarations in a program that come from the React source.
 *
 * @param program - The program node whose top-level statements are scanned.
 * @param importSource - The configured React import source.
 * @returns The matching import declarations, in source order.
 */
export function getReactImportDeclarations(
	program: TSESTree.Program,
	importSource: string,
): Array<TSESTree.ImportDeclaration> {
	return program.body.filter((statement): statement is TSESTree.ImportDeclaration => {
		return (
			statement.type === AST_NODE_TYPES.ImportDeclaration &&
			typeof statement.source.value === "string" &&
			matchesSource(statement.source.value, importSource)
		);
	});
}

/**
 * Classifies an import specifier by the kind of React binding it introduces:
 * named for `ImportSpecifier`, namespace for default and namespace specifiers.
 *
 * @param specifier - The specifier to classify.
 * @returns `"named"` or `"namespace"`.
 */
export function classifySpecifier(specifier: TSESTree.ImportClause): ReactImportKind {
	return specifier.type === AST_NODE_TYPES.ImportSpecifier ? "named" : "namespace";
}

/**
 * Finds the local name of a default or namespace React import, used to qualify a
 * bare type reference (`React.ReactNode`). Returns `null` when no such import
 * exists, in which case the caller ensures one under the name `React`.
 *
 * @param declarations - The React import declarations of the file.
 * @returns The local namespace name, or `null`.
 */
export function findReactNamespaceLocal(
	declarations: Array<TSESTree.ImportDeclaration>,
): null | string {
	for (const declaration of declarations) {
		for (const specifier of declaration.specifiers) {
			if (
				specifier.type === AST_NODE_TYPES.ImportDefaultSpecifier ||
				specifier.type === AST_NODE_TYPES.ImportNamespaceSpecifier
			) {
				return specifier.local.name;
			}
		}
	}

	return null;
}

/**
 * Whether the file already imports React as a default or namespace binding (so a
 * namespace type qualification resolves without adding an import).
 *
 * @param declarations - The React import declarations of the file.
 * @returns True when a default or namespace React import is present.
 */
export function hasReactNamespaceImport(declarations: Array<TSESTree.ImportDeclaration>): boolean {
	return findReactNamespaceLocal(declarations) !== null;
}

/**
 * Inserts a fresh import statement above the first statement of the program.
 *
 * @param fixer - The fixer used to build the edit.
 * @param program - The program whose head receives the import.
 * @param text - The full import statement (including trailing newline).
 * @returns The insertion fix.
 */
export function insertImportStatement(
	fixer: TSESLint.RuleFixer,
	program: TSESTree.Program,
	text: string,
): TSESLint.RuleFix {
	const first = program.body.at(0);
	if (first === undefined) {
		return fixer.insertTextAfterRange([0, 0], text);
	}

	return fixer.insertTextBefore(first, text);
}

/**
 * Builds the fix that ensures a named value import of `name` from the React
 * source, or `null` when it is already present. Prefers extending an existing
 * named import, then appending to a default import, and otherwise inserts a new
 * statement. Never touched for namespace-only imports, which cannot carry named
 * siblings and instead receive a fresh statement.
 *
 * @param fixer - The fixer used to build the edit.
 * @param parameters - The declarations, program, name, and source to import.
 * @returns The fix, or `null` when the import already exists.
 */
export function ensureNamedValueImport(
	fixer: TSESLint.RuleFixer,
	{ name, declarations, importSource, program }: EnsureNamedValueImportParameters,
): null | TSESLint.RuleFix {
	const valueDeclarations = declarations.filter(
		(declaration) => declaration.importKind !== "type",
	);

	for (const declaration of valueDeclarations) {
		for (const specifier of declaration.specifiers) {
			if (
				isNamedSpecifier(specifier) &&
				specifier.imported.type === AST_NODE_TYPES.Identifier &&
				specifier.imported.name === name
			) {
				return null;
			}
		}
	}

	for (const declaration of valueDeclarations) {
		const named = declaration.specifiers.filter(isNamedSpecifier);
		const last = named.at(-1);
		if (last !== undefined) {
			return fixer.insertTextAfter(last, `, ${name}`);
		}
	}

	for (const declaration of valueDeclarations) {
		const defaultSpecifier = declaration.specifiers.find(
			(specifier) => specifier.type === AST_NODE_TYPES.ImportDefaultSpecifier,
		);
		if (defaultSpecifier !== undefined) {
			return fixer.insertTextAfter(defaultSpecifier, `, { ${name} }`);
		}
	}

	return insertImportStatement(fixer, program, `import { ${name} } from "${importSource}";\n`);
}

/**
 * Removes a single named specifier from a React import, dropping the whole
 * declaration when it was the only binding. Handles the comma and braces that
 * surround the specifier so the remaining import stays well-formed.
 *
 * @param fixer - The fixer used to build the edit.
 * @param sourceCode - The source code, used to locate surrounding tokens.
 * @param declaration - The declaration owning the specifier.
 * @param specifier - The named specifier to remove.
 * @returns The removal fix.
 */
export function removeNamedSpecifier(
	fixer: TSESLint.RuleFixer,
	sourceCode: Readonly<TSESLint.SourceCode>,
	declaration: TSESTree.ImportDeclaration,
	specifier: TSESTree.ImportSpecifier,
): TSESLint.RuleFix {
	const named = declaration.specifiers.filter(isNamedSpecifier);
	const others = declaration.specifiers.filter((entry) => !isNamedSpecifier(entry));

	if (named.length === 1) {
		const lastOther = others.at(-1);
		if (lastOther === undefined) {
			return removeWholeDeclaration(fixer, sourceCode, declaration);
		}

		// `import React, { Foo } from …` → `import React from …`: drop from the
		// comma after the default binding through the closing brace.
		const comma = sourceCode.getTokenAfter(lastOther, (token) => token.value === ",");
		const closeBrace = sourceCode.getTokenAfter(specifier, (token) => token.value === "}");
		if (comma !== null && closeBrace !== null) {
			return fixer.removeRange([comma.range[0], closeBrace.range[1]]);
		}

		return fixer.remove(specifier);
	}

	const index = named.indexOf(specifier);
	if (index === named.length - 1) {
		const comma = sourceCode.getTokenBefore(specifier, (token) => token.value === ",");
		if (comma !== null) {
			return fixer.removeRange([comma.range[0], specifier.range[1]]);
		}

		return fixer.remove(specifier);
	}

	const comma = sourceCode.getTokenAfter(specifier, (token) => token.value === ",");
	if (comma !== null) {
		return fixer.removeRange([specifier.range[0], comma.range[1]]);
	}

	return fixer.remove(specifier);
}

/**
 * Finds the named specifier that binds `name` across the React import
 * declarations, or `null` when none does.
 *
 * @param declarations - The React import declarations of the file.
 * @param name - The local name of the binding to find.
 * @returns A specifier together with its declaration, or `null`.
 */
export function findNamedSpecifier(
	declarations: Array<TSESTree.ImportDeclaration>,
	name: string,
): null | {
	declaration: TSESTree.ImportDeclaration;
	specifier: TSESTree.ImportSpecifier;
} {
	for (const declaration of declarations) {
		for (const specifier of declaration.specifiers) {
			if (isNamedSpecifier(specifier) && specifier.local.name === name) {
				return { declaration, specifier };
			}
		}
	}

	return null;
}

/**
 * Resolves the React package the `react-x` `importSource` setting points at. The
 * setting may be a package (`react`, `@rbxts/react`) or a bare npm scope
 * (`@rbxts`, as Roblox configs set it). A scope names no package, so treating it
 * as one claims every sibling (`@rbxts/react-roblox`, `@rbxts/flux`) as React;
 * the React package under a scope is `<scope>/react`.
 *
 * @param importSource - The configured `react-x` import source.
 * @returns The React package name to match against.
 */
function resolveReactPackage(importSource: string): string {
	return SCOPE_PATTERN.test(importSource) ? `${importSource}/react` : importSource;
}

function isNamedSpecifier(specifier: TSESTree.ImportClause): specifier is TSESTree.ImportSpecifier {
	return specifier.type === AST_NODE_TYPES.ImportSpecifier;
}

/**
 * Removes a whole import declaration together with the line break that follows
 * it, so dropping the sole specifier of an import leaves no blank line.
 *
 * @param fixer - The fixer used to build the edit.
 * @param sourceCode - The source code, used to inspect trailing characters.
 * @param declaration - The declaration to remove.
 * @returns The removal fix.
 */
function removeWholeDeclaration(
	fixer: TSESLint.RuleFixer,
	{ text }: Readonly<TSESLint.SourceCode>,
	declaration: TSESTree.ImportDeclaration,
): TSESLint.RuleFix {
	const [start] = declaration.range;
	let end = declaration.range[1];
	if (text[end] === "\r") {
		end += 1;
	}

	if (text[end] === "\n") {
		end += 1;
	}

	return fixer.removeRange([start, end]);
}
