import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import path from "node:path";

import type { FlawlessRuleContext, FlawlessRuleListener, FlawlessRuleModule } from "../../util";
import { createFlawlessRule } from "../../util";
import { unwrapAssertedExpression } from "../shared/dictionary-types";

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
	return getArrowReturnValues(body).some((node) => isJsxElement(unwrapAssertedExpression(node)));
}

/**
 * Strips TypeScript expression wrappers (`as`, `satisfies`, `!`, `<T>`, and
 * `<T>` instantiation) that sit between a default export and its value. None
 * of them gives the arrow a name. Parentheses are not AST nodes, so they need
 * no handling.
 *
 * @param node - The default export's declaration.
 * @returns The innermost wrapped node.
 */
function unwrapTypeExpressions(
	node: TSESTree.ExportDefaultDeclaration["declaration"],
): TSESTree.ExportDefaultDeclaration["declaration"] {
	let current = node;
	while (
		current.type === AST_NODE_TYPES.TSAsExpression ||
		current.type === AST_NODE_TYPES.TSSatisfiesExpression ||
		current.type === AST_NODE_TYPES.TSNonNullExpression ||
		current.type === AST_NODE_TYPES.TSTypeAssertion ||
		current.type === AST_NODE_TYPES.TSInstantiationExpression
	) {
		current = current.expression;
	}

	return current;
}

/**
 * Derives the constant name from the filename stem: PascalCase when the arrow
 * returns JSX, camelCase otherwise.
 *
 * @param arrowFunction - The unwrapped default-exported arrow.
 * @param context - The rule context, for the filename.
 * @returns The generated name.
 */
function getFunctionName(
	arrowFunction: TSESTree.ArrowFunctionExpression,
	context: FlawlessRuleContext<MessageIds, Options>,
): string {
	const fileName = context.physicalFilename || context.filename || "namedFunction";
	const { name: stem } = path.parse(fileName);
	return arrowReturnIsJsxElement(arrowFunction.body) ? toPascalCase(stem) : toCamelCase(stem);
}

/**
 * Builds the autofix: replaces the `export default` keywords with
 * `const <name> =`, and appends `export default <name>` after the file's last
 * token (comments included, so a trailing comment keeps its position). The
 * rest of the declaration stays as written, so type wrappers, parentheses,
 * comments, and the trailing semicolon are kept.
 *
 * @param options - The export declaration, the generated name, and the source
 *   code needed to locate the keywords and the file's end.
 * @returns A fixer callback producing both edits, or `null` when the keywords
 *   cannot be found.
 */
function createFixFunction({
	exportDeclaration,
	functionName,
	sourceCode,
}: {
	exportDeclaration: TSESTree.ExportDefaultDeclaration;
	functionName: string;
	sourceCode: Readonly<TSESLint.SourceCode>;
}): null | TSESLint.ReportFixFunction {
	const defaultToken = sourceCode.getFirstToken(exportDeclaration, { skip: 1 });
	if (defaultToken?.value !== "default") {
		return null;
	}

	return (fixer) => {
		const lastToken = sourceCode.getLastToken(sourceCode.ast, { includeComments: true });

		return [
			fixer.replaceTextRange(
				[exportDeclaration.range[0], defaultToken.range[1]],
				`const ${functionName} =`,
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
 * unnamed functions in stack traces and devtools. Type wrappers around the
 * arrow do not give it a name, so the rule looks through them. The autofix is
 * skipped when the generated name is already bound in the module.
 *
 * @param context - The rule context.
 * @returns The rule listener.
 */
function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	return {
		ExportDefaultDeclaration(node: TSESTree.ExportDefaultDeclaration): void {
			const arrowFunction = unwrapTypeExpressions(node.declaration);
			if (arrowFunction.type !== AST_NODE_TYPES.ArrowFunctionExpression) {
				return;
			}

			const { sourceCode } = context;
			const functionName = getFunctionName(arrowFunction, context);
			const isNameTaken = sourceCode.getScope(node).set.has(functionName);

			context.report({
				fix: isNameTaken
					? null
					: createFixFunction({ exportDeclaration: node, functionName, sourceCode }),
				messageId: MESSAGE_ID,
				node: arrowFunction,
			});
		},
	};
}

export const noExportDefaultArrow: FlawlessRuleModule<Options, MessageIds> = createFlawlessRule<
	Options,
	MessageIds
>({
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
