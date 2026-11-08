import * as core from "@eslint-react/core";
import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import type { FlawlessRuleContext, FlawlessRuleListener, FlawlessRuleModule } from "../../util";
import { createFlawlessRule } from "../../util";
import { RESERVED_WORDS } from "../../utils/reserved-words";

export const RULE_NAME = "no-unnecessary-prop-alias";

const MESSAGE_ID = "unnecessaryAlias";
const MESSAGE_ID_CONFLICT = "conflictingAlias";

export type MessageIds = typeof MESSAGE_ID | typeof MESSAGE_ID_CONFLICT;

export interface NoUnnecessaryPropertyAliasOptions {
	/**
	 * Also report an alias that avoids a name conflict, and ask to rename the
	 * other binding instead.
	 */
	readonly reportConflicts?: boolean;
}

export type Options = [NoUnnecessaryPropertyAliasOptions?];

const messages = {
	[MESSAGE_ID]: "Prop '{{key}}' is aliased to '{{alias}}'. Use the prop name '{{key}}' instead.",
	[MESSAGE_ID_CONFLICT]:
		"Prop '{{key}}' is aliased to '{{alias}}' because another binding is named '{{key}}'. Rename that binding and use the prop name '{{key}}'.",
};

type Scope = TSESLint.Scope.Scope;
type Variable = TSESLint.Scope.Variable;

const IDENTIFIER_NAME = /^[$A-Z_a-z][\w$]*$/;

/**
 * Strips a parameter default (`{ a } = {}`) to reach the binding pattern.
 *
 * @param node - A parameter or a pattern.
 * @returns The binding pattern under any default.
 */
function unwrapDefault(node: TSESTree.Node): TSESTree.Node {
	return node.type === AST_NODE_TYPES.AssignmentPattern ? node.left : node;
}

function isWithin(node: TSESTree.Node, container: TSESTree.Node): boolean {
	return node.range[0] >= container.range[0] && node.range[1] <= container.range[1];
}

/**
 * Gets the prop name and alias of a destructured property, as in
 * `{ options: configuredOptions }` or `{ "title": heading = "" }`.
 *
 * @param property - A member of an object pattern.
 * @returns The key and alias names, or `undefined` when the property is not
 *   an alias whose key can be a binding name.
 */
function getAlias(
	property: TSESTree.ObjectPattern["properties"][number],
): undefined | { alias: string; key: string } {
	if (property.type !== AST_NODE_TYPES.Property || property.shorthand || property.computed) {
		return undefined;
	}

	const value = unwrapDefault(property.value);
	if (value.type !== AST_NODE_TYPES.Identifier) {
		return undefined;
	}

	const { key: keyNode } = property;
	let key: string | undefined;
	if (keyNode.type === AST_NODE_TYPES.Identifier) {
		key = keyNode.name;
	} else if (typeof keyNode.value === "string" && IDENTIFIER_NAME.test(keyNode.value)) {
		key = keyNode.value;
	}

	if (key === undefined || key === value.name || RESERVED_WORDS.has(key)) {
		return undefined;
	}

	return { key, alias: value.name };
}

/**
 * Gets the name of the binding that a JSX tag reads: `Label` in `<Label />` and
 * in `<Label.Item />`. A lowercase plain tag (`<div />`) is a host element and
 * reads no binding.
 *
 * @param name - The tag name of a JSX opening element.
 * @returns The binding name, or `undefined` when the tag reads none.
 */
function getJsxTagBinding(name: TSESTree.JSXTagNameExpression): string | undefined {
	if (name.type === AST_NODE_TYPES.JSXIdentifier) {
		const first = name.name[0];
		return first !== undefined && first !== first.toLowerCase() ? name.name : undefined;
	}

	let object: TSESTree.JSXTagNameExpression = name;
	while (object.type === AST_NODE_TYPES.JSXMemberExpression) {
		({ object } = object);
	}

	return object.type === AST_NODE_TYPES.JSXIdentifier ? object.name : undefined;
}

/**
 * Checks whether a variable is a local fallback for the alias, as in
 * `const options = configuredOptions ?? DefaultOptions`. The alias exists only
 * to free the prop name for this local, so the alias is still unnecessary.
 *
 * The local must be in the scope of the alias, its initializer must be a `??`,
 * `||`, `&&` or `?:` expression, and the code must read the alias only in that
 * initializer. Otherwise both names are needed (`useState(initialValue)`, or
 * the alias is read again later).
 *
 * @param variable - The local variable that has the prop name.
 * @param alias - The alias variable.
 * @returns True if the variable is a fallback for the alias.
 */
function isFallbackOf(variable: Variable, alias: Variable): boolean {
	if (variable.scope !== alias.scope || variable.defs.length !== 1) {
		return false;
	}

	const [{ node }] = variable.defs as [TSESLint.Scope.Definition];
	if (
		node.type !== AST_NODE_TYPES.VariableDeclarator ||
		(node.init?.type !== AST_NODE_TYPES.LogicalExpression &&
			node.init?.type !== AST_NODE_TYPES.ConditionalExpression)
	) {
		return false;
	}

	const { init } = node;
	const reads = alias.references.filter((reference) => reference.isRead());
	return reads.length > 0 && reads.every((reference) => isWithin(reference.identifier, init));
}

/**
 * Finds the parameter that holds the props, skipping a TypeScript `this`
 * parameter.
 *
 * @param parameters - The parameters of the component.
 * @returns The props parameter, if any.
 */
function getPropsParameter(parameters: Array<TSESTree.Parameter>): TSESTree.Parameter | undefined {
	const [first, second] = parameters;
	return first?.type === AST_NODE_TYPES.Identifier && first.name === "this" ? second : first;
}

/**
 * Finds the variables that hold props objects: an identifier parameter
 * (`props`), and the rest element of a destructured parameter (`...rest`).
 *
 * @param parameter - The props parameter of the component.
 * @param scope - The scope of the component function.
 * @returns The props parameter, the rest of the parameter pattern, or nothing.
 */
function getParameterPropsVariables(parameter: TSESTree.Node, scope: Scope): Array<Variable> {
	const binding = unwrapDefault(parameter);
	let name: string | undefined;
	if (binding.type === AST_NODE_TYPES.Identifier) {
		({ name } = binding);
	} else if (binding.type === AST_NODE_TYPES.ObjectPattern) {
		const rest = binding.properties.at(-1);
		if (
			rest?.type === AST_NODE_TYPES.RestElement &&
			rest.argument.type === AST_NODE_TYPES.Identifier
		) {
			({ name } = rest.argument);
		}
	}

	const variable = name === undefined ? undefined : scope.set.get(name);
	return variable === undefined ? [] : [variable];
}

/**
 * Gets the declarator whose object pattern reads an expression, looking through type
 * assertions: `const { a } = props`, `props as P`, `props!`, `props satisfies P`.
 *
 * @param identifier - A reference to a props variable.
 * @returns The declarator, if the reference is its initializer.
 */
function getDestructuringDeclarator(
	identifier: TSESTree.Identifier | TSESTree.JSXIdentifier,
): TSESTree.VariableDeclarator | undefined {
	let node: TSESTree.Node = identifier;
	while (
		node.parent.type === AST_NODE_TYPES.TSAsExpression ||
		node.parent.type === AST_NODE_TYPES.TSNonNullExpression ||
		node.parent.type === AST_NODE_TYPES.TSSatisfiesExpression
	) {
		node = node.parent;
	}

	const { parent } = node;
	if (
		parent.type === AST_NODE_TYPES.VariableDeclarator &&
		parent.init === node &&
		parent.id.type === AST_NODE_TYPES.ObjectPattern
	) {
		return parent;
	}

	return undefined;
}

/**
 * Reports unnecessary aliases of component props.
 *
 * Components are found by `@eslint-react/core`. The rule checks the
 * destructured props parameter, and each `const { ... } = props` where `props`
 * is the props parameter or a rest of it. Other destructuring (imports, hook
 * results, services, test helpers) is not props, so it is out of scope.
 *
 * @param context - The rule context.
 * @returns The rule listener.
 */
function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	// A fresh collector is built per file in `before` to reset its state.
	let collector = core.getFunctionComponentCollector(context);
	const selectorKeys = Object.keys(collector.visitor);
	// Most files have no alias, so the scope work in `Program:exit` is skipped.
	let hasAlias = false;
	let reportConflicts = false;
	// JSX tags that read a binding, found from the AST. The default parser of
	// ESLint does not record JSX tags as references.
	let jsxTags: Array<{ name: string; node: TSESTree.JSXOpeningElement }> = [];

	function isUsedAsJsxTag(name: string, scope: Scope): boolean {
		return jsxTags.some((tag) => tag.name === name && isWithin(tag.node, scope.block));
	}

	/**
	 * Checks whether the alias must stay because the prop name is not free where
	 * the alias lives. The name is not free when:
	 *
	 * - another binding has the prop name in the alias's scope, or in a scope
	 *   between a use of the alias and that scope (a local fallback for the
	 *   alias does not count);
	 * - code in the alias's scope reads an outer binding with the prop name.
	 *
	 * @param alias - The alias variable.
	 * @param key - The prop name.
	 * @returns True if the prop name is not free.
	 */
	function hasNameConflict(alias: Variable, key: string): boolean {
		const aliasScope = alias.scope;
		if (aliasScope.through.some((reference) => reference.identifier.name === key)) {
			return true;
		}

		const scopes = new Set<Scope>([aliasScope]);
		for (const reference of alias.references) {
			let scope: null | Scope = reference.from;
			while (scope !== null && scope !== aliasScope) {
				scopes.add(scope);
				scope = scope.upper;
			}
		}

		for (const scope of scopes) {
			const variable = scope.set.get(key);
			if (variable !== undefined && !isFallbackOf(variable, alias)) {
				return true;
			}
		}

		// A JSX tag with the prop name reads some binding, which the rename
		// would shadow or which is already a conflict.
		return isUsedAsJsxTag(key, aliasScope);
	}

	function checkPattern(pattern: TSESTree.ObjectPattern, scope: Scope): void {
		for (const property of pattern.properties) {
			const names = getAlias(property);
			if (names === undefined) {
				continue;
			}

			const { key, alias: aliasName } = names;
			const alias = scope.set.get(aliasName);
			if (alias === undefined) {
				continue;
			}

			// A lowercase prop name cannot render as a JSX tag.
			const startsLowercase = key[0] !== key[0]?.toUpperCase();
			if (startsLowercase && isUsedAsJsxTag(aliasName, alias.scope)) {
				continue;
			}

			const hasConflict = hasNameConflict(alias, key);
			if (hasConflict && !reportConflicts) {
				continue;
			}

			context.report({
				data: { key, alias: aliasName },
				messageId: hasConflict ? MESSAGE_ID_CONFLICT : MESSAGE_ID,
				node: property,
			});
		}
	}

	function checkPropsVariable(variable: Variable): void {
		const pending = [variable];
		const seen = new Set<Variable>();
		while (pending.length > 0) {
			const current = pending.pop();
			if (current === undefined || seen.has(current)) {
				continue;
			}

			seen.add(current);
			for (const reference of current.references) {
				const declarator = getDestructuringDeclarator(reference.identifier);
				if (declarator === undefined) {
					continue;
				}

				const pattern = declarator.id as TSESTree.ObjectPattern;
				const scope = reference.from;
				checkPattern(pattern, scope);
				const rest = pattern.properties.at(-1);
				if (
					rest?.type === AST_NODE_TYPES.RestElement &&
					rest.argument.type === AST_NODE_TYPES.Identifier
				) {
					const restVariable = scope.set.get(rest.argument.name);
					if (restVariable !== undefined) {
						pending.push(restVariable);
					}
				}
			}
		}
	}

	const listener: FlawlessRuleListener = {
		"before": function (): void {
			collector = core.getFunctionComponentCollector(context);
			hasAlias = false;
			jsxTags = [];
			reportConflicts = context.options[0]?.reportConflicts ?? false;
		},
		"JSXOpeningElement": function (node: TSESTree.JSXOpeningElement): void {
			const name = getJsxTagBinding(node.name);
			if (name !== undefined) {
				jsxTags.push({ name, node });
			}
		},
		"ObjectPattern": function (node: TSESTree.ObjectPattern): void {
			if (!hasAlias) {
				hasAlias = node.properties.some((property) => getAlias(property) !== undefined);
			}
		},
		"Program:exit": function (program: TSESTree.Program): void {
			if (!hasAlias) {
				return;
			}

			for (const component of collector.api.getAllComponents(program)) {
				const parameter = getPropsParameter(component.node.params);
				if (parameter === undefined) {
					continue;
				}

				const scope = context.sourceCode.getScope(component.node);
				const binding = unwrapDefault(parameter);
				if (binding.type === AST_NODE_TYPES.ObjectPattern) {
					checkPattern(binding, scope);
				}

				for (const variable of getParameterPropsVariables(parameter, scope)) {
					checkPropsVariable(variable);
				}
			}
		},
	};

	// Delegate the collector's selector handlers to the current per-file
	// instance.
	const handlers = listener as Record<string, (node: TSESTree.Node) => void>;
	for (const key of selectorKeys) {
		const own = handlers[key];
		handlers[key] = (node): void => {
			own?.(node);
			(collector.visitor as Record<string, ((node: TSESTree.Node) => void) | undefined>)[
				key
			]?.(node);
		};
	}

	return listener;
}

export const noUnnecessaryPropertyAlias: FlawlessRuleModule<Options, MessageIds> =
	createFlawlessRule<Options, MessageIds>({
		name: RULE_NAME,
		createOnce,
		defaultOptions: [{ reportConflicts: false }],
		meta: {
			defaultOptions: [{ reportConflicts: false }],
			docs: {
				description: "Disallow unnecessary aliases when destructuring component props",
				recommended: false,
				requiresTypeChecking: false,
			},
			hasSuggestions: false,
			messages,
			schema: [
				{
					additionalProperties: false,
					properties: {
						reportConflicts: {
							description:
								"Also report an alias that avoids a name conflict, and ask to rename the other binding instead.",
							type: "boolean",
						},
					},
					type: "object",
				},
			],
			type: "suggestion",
		},
	});
