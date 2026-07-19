import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import path from "node:path";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";

export const RULE_NAME = "no-export-default-arrow";

const MESSAGE_ID = "disallowExportDefaultArrow";

export type MessageIds = typeof MESSAGE_ID;

export type Options = [];

const messages = {
	[MESSAGE_ID]:
		"Assign the arrow function to a named constant instead of exporting it anonymously.",
};

/**
 * Converts a filename stem to camelCase, treating `-`, `_`, and whitespace as
 * word separators (`use-mouse` -> `useMouse`).
 *
 * @param value - The filename stem.
 * @returns The camelCase name.
 */
function toCamelCase(value: string): string {
	return value
		.replace(/[-_\s]+(.)?/g, (_, char: string | undefined) => char?.toUpperCase() ?? "")
		.replace(/^[A-Z]/, (char) => char.toLowerCase());
}

/**
 * Converts a filename stem to PascalCase, treating `-`, `_`, and whitespace as
 * word separators (`use-mouse` -> `UseMouse`).
 *
 * @param value - The filename stem.
 * @returns The PascalCase name.
 */
function toPascalCase(value: string): string {
	return value
		.replace(/[-_\s]+(.)?/g, (_, char: string | undefined) => char?.toUpperCase() ?? "")
		.replace(/^[a-z]/, (char) => char.toUpperCase());
}

/**
 * Checks whether a node is a JSX element or fragment.
 *
 * @param node - The expression to test.
 * @returns `true` when the node renders JSX.
 */
function isJsxElement(node: TSESTree.Expression): boolean {
	return node.type === AST_NODE_TYPES.JSXElement || node.type === AST_NODE_TYPES.JSXFragment;
}

/**
 * Collects the expressions an arrow function can return: the body itself for a
 * concise arrow, or every `return` argument for a block body.
 *
 * @param body - The arrow function's body.
 * @returns The returned expressions, in source order.
 */
function getArrowReturnValues(
	body: TSESTree.ArrowFunctionExpression["body"],
): Array<TSESTree.Expression> {
	if (body.type !== AST_NODE_TYPES.BlockStatement) {
		return [body];
	}

	return body.body
		.filter(
			(node): node is TSESTree.ReturnStatement =>
				node.type === AST_NODE_TYPES.ReturnStatement,
		)
		.map((node) => node.argument)
		.filter((argument): argument is TSESTree.Expression => argument !== null);
}

/**
 * Determines whether an arrow function is a component — that is, whether any of
 * its return values is JSX — which selects PascalCase for the generated name.
 *
 * @param body - The arrow function's body.
 * @returns `true` when the arrow can return JSX.
 */
function arrowReturnIsJsxElement(body: TSESTree.ArrowFunctionExpression["body"]): boolean {
	return getArrowReturnValues(body).some((node) => isJsxElement(node));
}

/**
 * Builds the autofix: replaces the `export default` declaration with a named
 * `const` derived from the filename, and appends `export default <name>` after
 * the file's last token (comments included, so a trailing comment keeps its
 * position).
 *
 * @param options - The reported arrow, its export declaration, and the context
 *   and source code needed to derive the name and locate the file's end.
 * @returns A fixer callback producing both edits.
 */
function createFixFunction({
	arrowFunction,
	context,
	exportDeclaration,
	sourceCode,
}: {
	arrowFunction: TSESTree.ArrowFunctionExpression;
	context: FlawlessRuleContext<MessageIds, Options>;
	exportDeclaration: TSESTree.ExportDefaultDeclaration;
	sourceCode: Readonly<TSESLint.SourceCode>;
}): TSESLint.ReportFixFunction {
	return (fixer) => {
		const program = sourceCode.ast;
		const lastToken = sourceCode.getLastToken(program, { includeComments: true });
		const fileName = context.physicalFilename || context.filename || "namedFunction";
		const { name: stem } = path.parse(fileName);
		const functionName = arrowReturnIsJsxElement(arrowFunction.body)
			? toPascalCase(stem)
			: toCamelCase(stem);

		return [
			fixer.replaceText(
				exportDeclaration,
				`const ${functionName} = ${sourceCode.getText(arrowFunction)}`,
			),
			fixer.insertTextAfter(
				lastToken ?? exportDeclaration,
				`\n\nexport default ${functionName}`,
			),
		];
	};
}

/**
 * Reports anonymous arrow functions used as `export default`, which surface as
 * unnamed functions in stack traces and devtools.
 *
 * @param context - The rule context.
 * @returns The rule listener.
 */
function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	return {
		ArrowFunctionExpression(node: TSESTree.ArrowFunctionExpression): void {
			const { parent } = node;
			if (parent.type !== AST_NODE_TYPES.ExportDefaultDeclaration) {
				return;
			}

			context.report({
				fix: createFixFunction({
					arrowFunction: node,
					context,
					exportDeclaration: parent,
					sourceCode: context.sourceCode,
				}),
				messageId: MESSAGE_ID,
				node,
			});
		},
	};
}

export const noExportDefaultArrow = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [],
	meta: {
		docs: {
			description: "Disallow anonymous arrow functions as export default declarations",
			recommended: false,
			requiresTypeChecking: false,
		},
		fixable: "code",
		hasSuggestions: false,
		messages,
		schema: [],
		type: "suggestion",
	},
});
