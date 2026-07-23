import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";
import type { ReactImportKind } from "./imports";
import {
	classifySpecifier,
	ensureNamedValueImport,
	findNamedSpecifier,
	findReactNamespaceLocal,
	getReactImportDeclarations,
	hasReactNamespaceImport,
	insertImportStatement,
	removeNamedSpecifier,
} from "./imports";

export const RULE_NAME = "react-namespace";

const MESSAGE_ID_RUNTIME = "runtimeNamespace";
const MESSAGE_ID_TYPE = "typeNamedImport";

export type MessageIds = typeof MESSAGE_ID_RUNTIME | typeof MESSAGE_ID_TYPE;

export type Options = [];

const DEFAULT_IMPORT_SOURCE = "react";

const messages = {
	[MESSAGE_ID_RUNTIME]:
		"Use a named import of '{{name}}' instead of accessing it through the React namespace.",
	[MESSAGE_ID_TYPE]:
		"Access the '{{name}}' type through the React namespace instead of importing it by name.",
};

/** How an identifier resolves to a React import binding. */
interface ReactImportResolution {
	kind: ReactImportKind;
	variable: TSESLint.Scope.Variable;
}

/** Per-binding facts that decide whether its named import can be removed. */
interface RemovableInfo {
	/** Whether every reference is a bare type reference this rule can qualify. */
	allConvertible: boolean;
	/** The start offset of the first reference in source order. */
	firstStart: number;
}

/**
 * Whether a member access is the target of an assignment (`React.x = …`), which
 * must be left alone — rewriting it to a bare name would create an assignment to
 * an import binding.
 *
 * @param node - The member expression under consideration.
 * @returns True when the member is an assignment target.
 */
function isAssignmentTarget(node: TSESTree.MemberExpression): boolean {
	return node.parent.type === AST_NODE_TYPES.AssignmentExpression && node.parent.left === node;
}

/**
 * Scans a binding's references once, recording whether all of them are bare
 * type references (`typeName` is the identifier itself) and where the first one
 * starts. The named import can be removed only when every reference is
 * convertible, and only the *first* reference carries the import edits.
 *
 * The import edits (adding the namespace import, removing the redundant
 * specifier) sit at the top of the file. ESLint merges a report's fix array into
 * one edit spanning `[min, max]`, so anchoring those edits to the first
 * reference keeps that span from the file head to the first usage — later
 * references stay disjoint and their own qualify edits survive a single pass.
 *
 * @param references - The references recorded for the binding.
 * @returns The convertibility and first-reference facts for the binding.
 */
function computeRemovableInfo(references: ReadonlyArray<TSESLint.Scope.Reference>): RemovableInfo {
	let allConvertible = true;
	let firstStart = Number.POSITIVE_INFINITY;

	for (const { identifier } of references) {
		firstStart = Math.min(firstStart, identifier.range[0]);
		if (
			identifier.parent.type !== AST_NODE_TYPES.TSTypeReference ||
			identifier.parent.typeName !== identifier
		) {
			allConvertible = false;
		}
	}

	return { allConvertible, firstStart };
}

function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	let importSource: string;
	let program: TSESTree.Program;
	let declarations: Array<TSESTree.ImportDeclaration>;
	let sourceCode: Readonly<TSESLint.SourceCode>;
	let resolutions: Map<TSESTree.Identifier | TSESTree.JSXIdentifier, ReactImportResolution>;
	let removableInfoByVariable: Map<TSESLint.Scope.Variable, RemovableInfo>;

	function getRemovableInfo(variable: TSESLint.Scope.Variable): RemovableInfo {
		let info = removableInfoByVariable.get(variable);
		if (info === undefined) {
			info = computeRemovableInfo(variable.references);
			removableInfoByVariable.set(variable, info);
		}

		return info;
	}

	return {
		before(): void {
			({ sourceCode } = context);
			const settings = context.settings["react-x"];
			importSource = settings?.importSource ?? DEFAULT_IMPORT_SOURCE;
			program = sourceCode.ast;
			declarations = getReactImportDeclarations(program, importSource);
			resolutions = new Map();
			removableInfoByVariable = new Map();

			// Index every reference to a React import binding up front, so the
			// per-node listeners resolve identifiers with a map lookup instead
			// of a scope-chain walk. Shadowed uses reference the shadowing
			// variable, not the import, so they never enter the map.
			for (const declaration of declarations) {
				for (const specifier of declaration.specifiers) {
					const kind = classifySpecifier(specifier);
					const [variable] = sourceCode.getDeclaredVariables(specifier);
					if (variable === undefined) {
						continue;
					}

					for (const reference of variable.references) {
						resolutions.set(reference.identifier, { kind, variable });
					}
				}
			}
		},
		MemberExpression(node: TSESTree.MemberExpression): void {
			if (
				node.computed ||
				node.object.type !== AST_NODE_TYPES.Identifier ||
				node.property.type !== AST_NODE_TYPES.Identifier ||
				isAssignmentTarget(node)
			) {
				return;
			}

			const { object, property } = node;
			if (resolutions.get(object)?.kind !== "namespace") {
				return;
			}

			context.report({
				data: { name: property.name },
				fix: (fixer) => {
					const fixes = [fixer.removeRange([object.range[0], property.range[0]])];
					const ensure = ensureNamedValueImport(fixer, {
						name: property.name,
						declarations,
						importSource,
						program,
					});
					if (ensure !== null) {
						fixes.push(ensure);
					}

					return fixes;
				},
				messageId: MESSAGE_ID_RUNTIME,
				node,
			});
		},
		TSTypeReference(node: TSESTree.TSTypeReference): void {
			if (node.typeName.type !== AST_NODE_TYPES.Identifier) {
				return;
			}

			const { typeName } = node;
			const resolution = resolutions.get(typeName);
			if (resolution?.kind !== "named") {
				return;
			}

			context.report({
				data: { name: typeName.name },
				fix: (fixer) => {
					const reactLocal = findReactNamespaceLocal(declarations) ?? "React";
					const fixes = [fixer.insertTextBefore(typeName, `${reactLocal}.`)];

					const info = getRemovableInfo(resolution.variable);
					const removable = info.allConvertible && typeName.range[0] === info.firstStart;

					// The import is ensured and the redundant specifier removed
					// only on the first reference, so both edits happen exactly
					// once.
					if (removable) {
						if (!hasReactNamespaceImport(declarations)) {
							fixes.push(
								insertImportStatement(
									fixer,
									program,
									`import ${reactLocal} from "${importSource}";\n`,
								),
							);
						}

						const found = findNamedSpecifier(declarations, typeName.name);
						if (found !== null) {
							fixes.push(
								removeNamedSpecifier(
									fixer,
									sourceCode,
									found.declaration,
									found.specifier,
								),
							);
						}
					}

					return fixes;
				},
				messageId: MESSAGE_ID_TYPE,
				node,
			});
		},
	};
}

export const reactNamespace = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [],
	meta: {
		docs: {
			description:
				"Prefer named imports for React runtime values and the React namespace for React types",
			recommended: false,
			requiresTypeChecking: false,
		},
		fixable: "code",
		hasSuggestions: false,
		messages,
		schema: [],
		type: "problem",
	},
});
