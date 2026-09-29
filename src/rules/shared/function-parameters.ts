import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

/** Every node kind that may carry a parameter's type annotation. */
type AnnotatedNode = TSESTree.DestructuringPattern | TSESTree.Parameter;

/** What is left of a parameter once rest, default, and modifiers are stripped. */
type ParameterBinding =
	| TSESTree.ArrayPattern
	| TSESTree.Identifier
	| TSESTree.MemberExpression
	| TSESTree.ObjectPattern;

export function parameterAnnotation(node: AnnotatedNode): TSESTree.TSTypeAnnotation | undefined {
	if (node.type === AST_NODE_TYPES.TSParameterProperty) {
		return parameterAnnotation(node.parameter);
	}

	if (node.type === AST_NODE_TYPES.RestElement) {
		return node.typeAnnotation ?? parameterAnnotation(node.argument);
	}

	if (node.type === AST_NODE_TYPES.AssignmentPattern) {
		return node.typeAnnotation ?? parameterAnnotation(node.left);
	}

	if (node.type === AST_NODE_TYPES.MemberExpression) {
		return undefined;
	}

	// Oxlint spells an absent annotation `null` where typescript-eslint uses
	// `undefined`; normalize so callers need one absence check.
	return node.typeAnnotation ?? undefined;
}

export function parameterBinding(node: AnnotatedNode): ParameterBinding {
	if (node.type === AST_NODE_TYPES.TSParameterProperty) {
		return parameterBinding(node.parameter);
	}

	if (node.type === AST_NODE_TYPES.RestElement) {
		return parameterBinding(node.argument);
	}

	if (node.type === AST_NODE_TYPES.AssignmentPattern) {
		return parameterBinding(node.left);
	}

	return node;
}

/**
 * Names the reported parameter. Destructured parameters have no name, so the
 * binding pattern's own source text is used with any type annotation removed
 * (the annotation is part of the pattern node's range).
 *
 * @param parameter - The offending parameter.
 * @param sourceCode - The source code of the linted file.
 * @returns A human-readable name for the parameter.
 */
export function parameterName(
	parameter: TSESTree.Parameter,
	sourceCode: Readonly<TSESLint.SourceCode>,
): string {
	const binding = parameterBinding(parameter);
	if (binding.type === AST_NODE_TYPES.Identifier) {
		return binding.name;
	}

	const text = sourceCode.getText(binding);
	const annotation =
		binding.type === AST_NODE_TYPES.MemberExpression
			? undefined
			: (binding.typeAnnotation ?? undefined);
	if (annotation === undefined) {
		return text;
	}

	return text.slice(0, annotation.range[0] - binding.range[0]).replace(/\s*:?\s*$/u, "");
}

/**
 * Whether a type is, or unions in, TypeScript's absorbing `unknown` top type.
 *
 * @param type - The type to inspect.
 * @returns True when the type admits any value.
 */
export function containsUnknownType(type: TSESTree.TypeNode): boolean {
	if (type.type === AST_NODE_TYPES.TSUnknownKeyword) {
		return true;
	}

	return type.type === AST_NODE_TYPES.TSUnionType && type.types.some(containsUnknownType);
}
