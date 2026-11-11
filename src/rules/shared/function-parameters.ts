import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

/** Every node kind that may carry a parameter's type annotation. */
type AnnotatedNode = TSESTree.DestructuringPattern | TSESTree.Parameter;

/**
 * What is left of a parameter once rest, default, and modifiers are stripped.
 */
type ParameterBinding =
	| TSESTree.ArrayPattern
	| TSESTree.Identifier
	| TSESTree.MemberExpression
	| TSESTree.ObjectPattern;

export function parameterAnnotation(node: AnnotatedNode): TSESTree.TSTypeAnnotation | undefined {
	let current = node;
	for (;;) {
		if (current.type === AST_NODE_TYPES.TSParameterProperty) {
			current = current.parameter;
			continue;
		}

		if (current.type === AST_NODE_TYPES.MemberExpression) {
			return undefined;
		}

		// Oxlint spells an absent annotation `null` where typescript-eslint uses
		// `undefined`; normalize so callers need one absence check.
		const annotation = current.typeAnnotation ?? undefined;
		if (annotation !== undefined) {
			return annotation;
		}

		if (current.type === AST_NODE_TYPES.RestElement) {
			current = current.argument;
		} else if (current.type === AST_NODE_TYPES.AssignmentPattern) {
			current = current.left;
		} else {
			return undefined;
		}
	}
}

export function parameterBinding(node: AnnotatedNode): ParameterBinding {
	let current = node;
	while (
		current.type === AST_NODE_TYPES.TSParameterProperty ||
		current.type === AST_NODE_TYPES.RestElement ||
		current.type === AST_NODE_TYPES.AssignmentPattern
	) {
		if (current.type === AST_NODE_TYPES.TSParameterProperty) {
			current = current.parameter;
		} else if (current.type === AST_NODE_TYPES.RestElement) {
			current = current.argument;
		} else {
			current = current.left;
		}
	}

	return current;
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

	const head = text.slice(0, annotation.range[0] - binding.range[0]).trimEnd();
	return head.endsWith(":") ? head.slice(0, -1).trimEnd() : head;
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
