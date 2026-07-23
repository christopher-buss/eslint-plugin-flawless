import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";
import { findVariable } from "@typescript-eslint/utils/ast-utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";
import {
	ensureNamedValueImport,
	findNamedSpecifier,
	findReactNamespaceLocal,
	getReactImportDeclarations,
	hasReactNamespaceImport,
	insertImportStatement,
	removeNamedSpecifier,
	resolveReactImport,
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
 * Whether every reference to a binding is a bare type reference that this rule
 * can qualify (`typeName` is the identifier itself). When true, the named import
 * can be removed once the last such reference is qualified.
 *
 * @param references - The references recorded for the binding.
 * @returns True when all references are convertible type references.
 */
function allRefsConvertibleTypes(references: ReadonlyArray<TSESLint.Scope.Reference>): boolean {
	return references.every(({ identifier }) => {
		return (
			identifier.parent.type === AST_NODE_TYPES.TSTypeReference &&
			identifier.parent.typeName === identifier
		);
	});
}

/**
 * Whether the given identifier is the first (lowest-positioned) reference to its
 * binding, so specifier removal happens exactly once.
 *
 * The import edits (adding the namespace import, removing the redundant
 * specifier) sit at the top of the file. ESLint merges a report's fix array into
 * one edit spanning `[min, max]`, so anchoring those edits to the *first*
 * reference keeps that span from the file head to the first usage — later
 * references stay disjoint and their own qualify edits survive a single pass.
 *
 * @param references - The references recorded for the binding.
 * @param identifier - The identifier currently being reported.
 * @returns True when the identifier is the first reference in source order.
 */
function isFirstReference(
	references: ReadonlyArray<TSESLint.Scope.Reference>,
	identifier: TSESTree.Identifier,
): boolean {
	const firstStart = Math.min(...references.map((reference) => reference.identifier.range[0]));
	return identifier.range[0] === firstStart;
}

function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	let importSource: string;
	let program: TSESTree.Program;
	let declarations: Array<TSESTree.ImportDeclaration>;
	let sourceCode: Readonly<TSESLint.SourceCode>;

	return {
		before(): void {
			({ sourceCode } = context);
			const settings = context.settings["react-x"];
			importSource = settings?.importSource ?? DEFAULT_IMPORT_SOURCE;
			program = sourceCode.ast;
			declarations = getReactImportDeclarations(program, importSource);
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
			const scope = sourceCode.getScope(object);
			if (resolveReactImport(scope, object, importSource) !== "namespace") {
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
			const scope = sourceCode.getScope(typeName);
			if (resolveReactImport(scope, typeName, importSource) !== "named") {
				return;
			}

			context.report({
				data: { name: typeName.name },
				fix: (fixer) => {
					const reactLocal = findReactNamespaceLocal(declarations) ?? "React";
					const fixes = [fixer.insertTextBefore(typeName, `${reactLocal}.`)];

					const variable = findVariable(scope, typeName);
					const references = variable?.references ?? [];
					const removable =
						variable !== null &&
						isFirstReference(references, typeName) &&
						allRefsConvertibleTypes(references);

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
