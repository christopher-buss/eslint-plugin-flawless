/* eslint-disable eslint-plugin/no-property-in-node -- TODO: Refactor */
/* eslint-disable ts/unbound-method -- TODO: Refactor  */
import type { ScopeManager, ScopeVariable } from "@typescript-eslint/scope-manager";
import { ImplicitLibVariable, ScopeType, Visitor } from "@typescript-eslint/scope-manager";
import type { TSESTree } from "@typescript-eslint/utils";
import { AST_NODE_TYPES, ASTUtils, ESLintUtils, TSESLint } from "@typescript-eslint/utils";

import assert from "node:assert";

import { isTypeImport } from "./is-type-import";
import { referenceContainsTypeQuery } from "./reference-contains-type-query";

interface MutableVariableAnalysis {
	readonly unusedVariables: Set<ScopeVariable>;
	readonly usedVariables: Set<ScopeVariable>;
}
interface VariableAnalysis {
	readonly unusedVariables: ReadonlySet<ScopeVariable>;
	readonly usedVariables: ReadonlySet<ScopeVariable>;
}

/**
 * This class leverages an AST visitor to mark variables as used via the
 * `eslintUsed` property.
 */
class UnusedVariablesVisitor extends Visitor {
	/**
	 * We keep a weak cache so that multiple rules can share the calculation.
	 */
	private static readonly RESULTS_CACHE = new WeakMap<TSESTree.Program, VariableAnalysis>();

	readonly #scopeManager: TSESLint.Scope.ScopeManager;

	protected ClassDeclaration = this.visitClass;
	protected ClassExpression = this.visitClass;
	protected ForInStatement = this.visitForInForOf;
	/**
	 * #region HELPERS
	 */
	protected ForOfStatement = this.visitForInForOf;
	protected FunctionDeclaration = this.visitFunction;
	protected FunctionExpression = this.visitFunction;
	protected MethodDefinition = this.visitSetter;
	protected Property = this.visitSetter;
	protected TSCallSignatureDeclaration = this.visitFunctionTypeSignature;
	protected TSConstructorType = this.visitFunctionTypeSignature;
	// eslint-disable-next-line id-length -- keeping consistent with ESTree naming
	protected TSConstructSignatureDeclaration = this.visitFunctionTypeSignature;
	protected TSDeclareFunction = this.visitFunctionTypeSignature;
	// #endregion HELPERS
	// #region VISITORS
	/**
	 * NOTE - This is a simple visitor - meaning it does not support selectors.
	 */
	protected TSEmptyBodyFunctionExpression = this.visitFunctionTypeSignature;
	protected TSFunctionType = this.visitFunctionTypeSignature;
	protected TSMethodSignature = this.visitFunctionTypeSignature;

	private constructor(scopeManager: ScopeManager) {
		super({
			visitChildrenEvenIfSelectorExists: true,
		});

		this.#scopeManager = scopeManager;
	}

	public static collectUnusedVariables(
		program: TSESTree.Program,
		scopeManager: ScopeManager,
	): VariableAnalysis {
		const cached = this.RESULTS_CACHE.get(program);
		if (cached) {
			return cached;
		}

		const visitor = new this(scopeManager);
		visitor.visit(program);

		const unusedVariables = visitor.collectUnusedVariables({
			scope: visitor.getScope(program),
		});
		this.RESULTS_CACHE.set(program, unusedVariables);
		return unusedVariables;
	}

	protected Identifier(node: TSESTree.Identifier): void {
		const scope = this.getScope(node);
		if (
			scope.type === TSESLint.Scope.ScopeType.function &&
			node.name === "this" &&
			// this parameters should always be considered used as they're
			// pseudo-parameters
			"params" in scope.block &&
			scope.block.params.includes(node)
		) {
			this.markVariableAsUsed(node);
		}
	}

	protected TSEnumDeclaration(node: TSESTree.TSEnumDeclaration): void {
		// enum members create variables because they can be referenced within
		// the enum, but they obviously aren't unused variables for the purposes
		// of this rule.
		const scope = this.getScope(node);
		for (const variable of scope.variables) {
			this.markVariableAsUsed(variable);
		}
	}

	protected TSMappedType(node: TSESTree.TSMappedType): void {
		// mapped types create a variable for their type name, but it's not
		// necessary to reference it, so we shouldn't consider it as unused for
		// the purpose of this rule.
		this.markVariableAsUsed(node.key);
	}

	protected TSModuleDeclaration(node: TSESTree.TSModuleDeclaration): void {
		// -- global augmentation can be in any file, and they do not need exports
		if (node.kind === "global") {
			this.markVariableAsUsed("global", node.parent);
		}
	}

	protected TSParameterProperty(node: TSESTree.TSParameterProperty): void {
		let identifier: TSESTree.Identifier | undefined;

		if (node.parameter.type === AST_NODE_TYPES.AssignmentPattern) {
			if (node.parameter.left.type === AST_NODE_TYPES.Identifier) {
				identifier = node.parameter.left;
			}
		} else if (node.parameter.type === AST_NODE_TYPES.Identifier) {
			identifier = node.parameter;
		}

		if (identifier) {
			this.markVariableAsUsed(identifier);
		}
	}

	private collectUnusedVariables({
		scope,
		variables = {
			unusedVariables: new Set(),
			usedVariables: new Set(),
		},
	}: {
		scope: TSESLint.Scope.Scope;
		variables?: MutableVariableAnalysis;
	}): VariableAnalysis {
		if (
			// skip function expression names
			// this scope is created just to house the variable that allows a
			// function expression to self-reference if it has a name defined
			!scope.functionExpressionScope
		) {
			for (const variable of scope.variables) {
				// cases that we don't want to treat as used or unused
				if (
					// implicit lib variables (from
					// @typescript-eslint/scope-manager) these aren't variables
					// that should be checked ever
					variable instanceof ImplicitLibVariable
				) {
					continue;
				}

				if (
					// variables marked with markVariableAsUsed()
					variable.eslintUsed ||
					// basic exported variables
					isExported(variable) ||
					// variables implicitly exported via a merged declaration
					isMergeableExported(variable) ||
					// used variables
					isUsedVariable(variable)
				) {
					variables.usedVariables.add(variable);
				} else {
					variables.unusedVariables.add(variable);
				}
			}
		}

		for (const childScope of scope.childScopes) {
			this.collectUnusedVariables({ scope: childScope, variables });
		}

		return variables;
	}

	private getScope(currentNode: TSESTree.Node): TSESLint.Scope.Scope {
		// On Program node, get the outermost scope to avoid return Node.js
		// special function scope or ES modules scope.
		const inner = currentNode.type !== AST_NODE_TYPES.Program;

		let node: TSESTree.Node | undefined = currentNode;
		while (node) {
			const scope = this.#scopeManager.acquire(node, inner);

			if (scope) {
				if (scope.type === ScopeType.functionExpressionName) {
					const returnValue = scope.childScopes[0];
					assert(returnValue, "Function expression name scope should have a child scope");
					return returnValue;
				}

				return scope;
			}

			node = node.parent;
		}

		const returnValue = this.#scopeManager.scopes[0];
		assert(returnValue, "There should be at least one scope");
		return returnValue;
	}

	private markVariableAsUsed(variableOrIdentifier: ScopeVariable | TSESTree.Identifier): void;
	private markVariableAsUsed(name: string, parent: TSESTree.Node): void;
	private markVariableAsUsed(
		variableOrIdentifierOrName: ScopeVariable | string | TSESTree.Identifier,
		parent?: TSESTree.Node,
	): void {
		if (
			typeof variableOrIdentifierOrName !== "string" &&
			!("type" in variableOrIdentifierOrName)
		) {
			variableOrIdentifierOrName.eslintUsed = true;
			return;
		}

		let name: string;
		let node: TSESTree.Node;
		if (typeof variableOrIdentifierOrName === "string") {
			name = variableOrIdentifierOrName;
			assert(parent, "Parent node is required when marking by name");
			node = parent;
		} else {
			({ name } = variableOrIdentifierOrName);
			node = variableOrIdentifierOrName;
		}

		let currentScope: TSESLint.Scope.Scope | undefined = this.getScope(node);
		while (currentScope) {
			const variable = currentScope.variables.find(
				(scopeVariable) => scopeVariable.name === name,
			);

			if (variable) {
				variable.eslintUsed = true;
				return;
			}

			currentScope = currentScope.upper ?? undefined;
		}
	}

	private visitClass(node: TSESTree.ClassDeclaration | TSESTree.ClassExpression): void {
		// skip a variable of class itself name in the class scope
		const scope = this.getScope(node) as TSESLint.Scope.Scopes.ClassScope;
		for (const variable of scope.variables) {
			if (variable.identifiers[0] === scope.block.id) {
				this.markVariableAsUsed(variable);
				return;
			}
		}
	}

	private visitForInForOf(node: TSESTree.ForInStatement | TSESTree.ForOfStatement): void {
		/**
		 * // cspell:ignore Zacher
		 * (Brad Zacher): I hate that this has to exist.
		 * But it is required for compat with the base ESLint rule.
		 *
		 * In 2015, ESLint decided to add an exception for these two specific cases.
		 * ```
		 * for (var key in object) return;
		 *
		 * var key;
		 * for (key in object) return;
		 * ```
		 *
		 * I disagree with it, but what are you going to do...
		 *
		 * Https://github.com/eslint/eslint/issues/2342.
		 */

		let idOrVariable;
		if (node.left.type === AST_NODE_TYPES.VariableDeclaration) {
			const variable = this.#scopeManager.getDeclaredVariables(node.left).at(0);
			if (!variable) {
				return;
			}

			idOrVariable = variable;
		}

		if (node.left.type === AST_NODE_TYPES.Identifier) {
			idOrVariable = node.left;
		}

		if (idOrVariable === undefined) {
			return;
		}

		let { body } = node;
		if (body.type === AST_NODE_TYPES.BlockStatement) {
			if (body.body.length !== 1) {
				return;
			}

			// eslint-disable-next-line ts/no-non-null-assertion -- checked length above
			body = body.body[0]!;
		}

		if (body.type !== AST_NODE_TYPES.ReturnStatement) {
			return;
		}

		this.markVariableAsUsed(idOrVariable);
	}

	private visitFunction(node: TSESTree.FunctionDeclaration | TSESTree.FunctionExpression): void {
		const scope = this.getScope(node);
		// skip implicit "arguments" variable
		const variable = scope.set.get("arguments");
		if (variable?.defs.length === 0) {
			this.markVariableAsUsed(variable);
		}
	}

	private visitFunctionTypeSignature(
		node:
			| TSESTree.TSCallSignatureDeclaration
			| TSESTree.TSConstructorType
			| TSESTree.TSConstructSignatureDeclaration
			| TSESTree.TSDeclareFunction
			| TSESTree.TSEmptyBodyFunctionExpression
			| TSESTree.TSFunctionType
			| TSESTree.TSMethodSignature,
	): void {
		// function type signature params create variables because they can be
		// referenced within the signature, but they obviously aren't unused
		// variables for the purposes of this rule.
		for (const parameter of node.params) {
			this.visitPattern(parameter, (name) => {
				this.markVariableAsUsed(name);
			});
		}
	}

	private visitSetter(node: TSESTree.MethodDefinition | TSESTree.Property): void {
		if (node.kind === "set") {
			// ignore setter parameters because they're syntactically required to
			// exist
			for (const parameter of (node.value as TSESTree.FunctionLike).params) {
				this.visitPattern(parameter, (id) => {
					this.markVariableAsUsed(id);
				});
			}
		}
	}

	// #endregion VISITORS
}

// #region private helpers

/**
 * Checks the position of given nodes.
 * @param inner - A node which is expected as inside.
 * @param outer - A node which is expected as outside.
 * @returns `true` if the `inner` node exists in the `outer` node.
 */
function isInside(inner: TSESTree.Node, outer: TSESTree.Node): boolean {
	return inner.range[0] >= outer.range[0] && inner.range[1] <= outer.range[1];
}

/**
 * Determine if an identifier is referencing an enclosing name.
 * This only applies to declarations that create their own scope (modules, functions, classes).
 * @param ref - The reference to check.
 * @param nodes - The candidate function nodes.
 * @returns True if it's a self-reference, false if not.
 */
function isSelfReference(ref: TSESLint.Scope.Reference, nodes: Set<TSESTree.Node>): boolean {
	let scope: TSESLint.Scope.Scope | undefined = ref.from;

	while (scope) {
		if (nodes.has(scope.block)) {
			return true;
		}

		scope = scope.upper ?? undefined;
	}

	return false;
}

const MERGEABLE_TYPES = new Set([
	AST_NODE_TYPES.ClassDeclaration,
	AST_NODE_TYPES.FunctionDeclaration,
	AST_NODE_TYPES.TSInterfaceDeclaration,
	AST_NODE_TYPES.TSModuleDeclaration,
	AST_NODE_TYPES.TSTypeAliasDeclaration,
]);
/**
 * Determines if a given variable is being exported from a module.
 * @param variable - Eslint-scope variable object.
 * @returns True if the variable is exported, false if not.
 */
function isExported(variable: ScopeVariable): boolean {
	return variable.defs.some((definition) => {
		let { node } = definition;

		if (node.type === AST_NODE_TYPES.VariableDeclarator) {
			node = node.parent;
		} else if (definition.type === TSESLint.Scope.DefinitionType.Parameter) {
			return false;
		}

		return node.parent.type.startsWith("Export");
	});
}

/**
 * Determine if the variable is directly exported.
 * @param variable - The variable to check.
 * @returns True if the variable is exported via a merged declaration.
 */
function isMergeableExported(variable: ScopeVariable): boolean {
	// If all of the merged things are of the same type, TS will error if not all
	// of them are exported - so we only need to find one
	for (const definition of variable.defs) {
		// parameters can never be exported.
		// their `node` prop points to the function decl, which can be exported
		// so we need to special case them
		if (definition.type === TSESLint.Scope.DefinitionType.Parameter) {
			continue;
		}

		if (
			(MERGEABLE_TYPES.has(definition.node.type) &&
				definition.node.parent.type === AST_NODE_TYPES.ExportNamedDeclaration) ||
			definition.node.parent.type === AST_NODE_TYPES.ExportDefaultDeclaration
		) {
			return true;
		}
	}

	return false;
}

const LOGICAL_ASSIGNMENT_OPERATORS = new Set(["&&=", "??=", "||="]);

/**
 * Collects the set of unused variables for a given context.
 *
 * Due to complexity, this does not take into consideration:
 * - variables within declaration files
 * - variables within ambient module declarations.
 * @param context - The rule context.
 * @returns The collected variables.
 * @template MessageIds
 * @template Options
 */
export function collectVariables<MessageIds extends string, Options extends ReadonlyArray<unknown>>(
	context: Readonly<TSESLint.RuleContext<MessageIds, Options>>,
): VariableAnalysis {
	return UnusedVariablesVisitor.collectUnusedVariables(
		context.sourceCode.ast,
		ESLintUtils.nullThrows(context.sourceCode.scopeManager, "Missing required scope manager"),
	);
}

// #endregion private helpers

/**
 * Determines if the variable is used.
 * @param variable - The variable to check.
 * @returns True if the variable is used.
 */
function isUsedVariable(variable: ScopeVariable): boolean {
	/**
	 * Gets a list of function definitions for a specified variable.
	 * @param scopeVariable - Eslint-scope variable object.
	 * @returns Function nodes.
	 */
	function getFunctionDefinitions(scopeVariable: ScopeVariable): Set<TSESTree.Node> {
		const functionDefinitions = new Set<TSESTree.Node>();

		for (const definition of scopeVariable.defs) {
			// FunctionDeclarations
			if (definition.type === TSESLint.Scope.DefinitionType.FunctionName) {
				functionDefinitions.add(definition.node);
			}

			// FunctionExpressions
			if (
				definition.type === TSESLint.Scope.DefinitionType.Variable &&
				(definition.node.init?.type === AST_NODE_TYPES.FunctionExpression ||
					definition.node.init?.type === AST_NODE_TYPES.ArrowFunctionExpression)
			) {
				functionDefinitions.add(definition.node.init);
			}
		}

		return functionDefinitions;
	}

	function getTypeDeclarations(scopeVariable: ScopeVariable): Set<TSESTree.Node> {
		const nodes = new Set<TSESTree.Node>();

		for (const definition of scopeVariable.defs) {
			if (
				definition.node.type === AST_NODE_TYPES.TSInterfaceDeclaration ||
				definition.node.type === AST_NODE_TYPES.TSTypeAliasDeclaration
			) {
				nodes.add(definition.node);
			}
		}

		return nodes;
	}

	function getModuleDeclarations(scopeVariable: ScopeVariable): Set<TSESTree.Node> {
		const nodes = new Set<TSESTree.Node>();

		for (const definition of scopeVariable.defs) {
			if (definition.node.type === AST_NODE_TYPES.TSModuleDeclaration) {
				nodes.add(definition.node);
			}
		}

		return nodes;
	}

	function getEnumDeclarations(scopeVariable: ScopeVariable): Set<TSESTree.Node> {
		const nodes = new Set<TSESTree.Node>();

		for (const definition of scopeVariable.defs) {
			if (definition.node.type === AST_NODE_TYPES.TSEnumDeclaration) {
				nodes.add(definition.node);
			}
		}

		return nodes;
	}

	/**
	 * Checks if the ref is contained within one of the given nodes.
	 * @param ref - A reference to check.
	 * @param nodes - A set of nodes.
	 * @returns `true` if the ref is inside one of the nodes.
	 */
	function isInsideOneOf(ref: TSESLint.Scope.Reference, nodes: Set<TSESTree.Node>): boolean {
		for (const node of nodes) {
			if (isInside(ref.identifier, node)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Checks whether a given node is unused expression or not.
	 * @param node - The node itself.
	 * @returns The node is an unused expression.
	 */
	function isUnusedExpression(node: TSESTree.Expression): boolean {
		const { parent } = node;

		if (parent.type === AST_NODE_TYPES.ExpressionStatement) {
			return true;
		}

		if (parent.type === AST_NODE_TYPES.SequenceExpression) {
			const isLastExpression = parent.expressions[parent.expressions.length - 1] === node;

			if (!isLastExpression) {
				return true;
			}

			return isUnusedExpression(parent);
		}

		return false;
	}

	/**
	 * If a given reference is left-hand side of an assignment, this gets
	 * the right-hand side node of the assignment.
	 *
	 * In the following cases, this returns undefined.
	 *
	 * - The reference is not the LHS of an assignment expression.
	 * - The reference is inside of a loop.
	 * - The reference is inside of a function scope which is different from
	 *   the declaration.
	 * @param ref - A reference to check.
	 * @param previousRhsNode - The previous RHS node. This is for `a = a + a`-like code.
	 * @returns The RHS node or undefined.
	 */
	function getRhsNode(
		ref: TSESLint.Scope.Reference,
		previousRhsNode: TSESTree.Node | undefined,
	): TSESTree.Node | undefined {
		/**
		 * Checks whether the given node is in a loop or not.
		 * @param node - The node to check.
		 * @returns `true` if the node is in a loop.
		 */
		function isInLoop(node: TSESTree.Node): boolean {
			let currentNode: TSESTree.Node | undefined = node;
			while (currentNode) {
				if (ASTUtils.isFunction(currentNode)) {
					break;
				}

				if (ASTUtils.isLoop(currentNode)) {
					return true;
				}

				currentNode = currentNode.parent;
			}

			return false;
		}

		const id = ref.identifier;
		const { parent } = id;
		const refScope = ref.from.variableScope;
		// eslint-disable-next-line ts/no-non-null-assertion -- exists
		const { variableScope } = ref.resolved!.scope;
		const canBeUsedLater = refScope !== variableScope || isInLoop(id);

		// Inherits the previous node if this reference is in the node.
		// This is for `a = a + a`-like code.
		if (previousRhsNode && isInside(id, previousRhsNode)) {
			return previousRhsNode;
		}

		if (
			parent.type === AST_NODE_TYPES.AssignmentExpression &&
			isUnusedExpression(parent) &&
			id === parent.left &&
			!canBeUsedLater
		) {
			return parent.right;
		}

		return undefined;
	}

	/**
	 * Checks whether a given reference is a read to update itself or not.
	 * @param ref - A reference to check.
	 * @param rhsNode - The RHS node of the previous assignment.
	 * @returns The reference is a read to update itself.
	 */
	function isReadForItself(
		ref: TSESLint.Scope.Reference,
		rhsNode: TSESTree.Node | undefined,
	): boolean {
		/**
		 * Checks whether a given Identifier node exists inside of a function node which can be used later.
		 *
		 * "can be used later" means:
		 * - the function is assigned to a variable.
		 * - the function is bound to a property and the object can be used later.
		 * - the function is bound as an argument of a function call.
		 *
		 * If a reference exists in a function which can be used later, the reference is read when the function is called.
		 * @param id - An Identifier node to check.
		 * @param rightHandSideNode - The RHS node of the previous assignment.
		 * @returns `true` if the `id` node exists inside of a function node which can be used later.
		 */
		function isInsideOfStorableFunction(
			id: TSESTree.Node,
			rightHandSideNode: TSESTree.Node,
		): boolean {
			/**
			 * Finds a function node from ancestors of a node.
			 * @param node - A start node to find.
			 * @returns A found function node.
			 */
			function getUpperFunction(node: TSESTree.Node): TSESTree.Node | undefined {
				let currentNode: TSESTree.Node | undefined = node;
				while (currentNode) {
					if (ASTUtils.isFunction(currentNode)) {
						return currentNode;
					}

					currentNode = currentNode.parent;
				}

				return undefined;
			}

			/**
			 * Checks whether a given function node is stored to somewhere or not.
			 * If the function node is stored, the function can be used later.
			 * @param funcNode - A function node to check.
			 * @param storableRhsNode - The RHS node of the previous assignment.
			 * @returns `true` if under the following conditions:
			 *      - the funcNode is assigned to a variable.
			 *      - the funcNode is bound as an argument of a function call.
			 *      - the function is bound to a property and the object satisfies above conditions.
			 */
			function isStorableFunction(
				funcNode: TSESTree.Node,
				storableRhsNode: TSESTree.Node,
			): boolean {
				let node = funcNode;
				let { parent } = funcNode;

				while (parent && isInside(parent, storableRhsNode)) {
					// eslint-disable-next-line ts/switch-exhaustiveness-check -- won't be fixed
					switch (parent.type) {
						case AST_NODE_TYPES.AssignmentExpression:
						case AST_NODE_TYPES.TaggedTemplateExpression:
						case AST_NODE_TYPES.YieldExpression: {
							return true;
						}
						case AST_NODE_TYPES.CallExpression:
						case AST_NODE_TYPES.NewExpression: {
							return parent.callee !== node;
						}
						case AST_NODE_TYPES.SequenceExpression: {
							if (parent.expressions[parent.expressions.length - 1] !== node) {
								return false;
							}

							break;
						}
						default: {
							if (
								parent.type.endsWith("Statement") ||
								parent.type.endsWith("Declaration")
							) {
								// If it encountered statements, this is a
								// complex pattern. Since analyzing complex
								// patterns is hard, this returns `true` to avoid
								// false positive.
								return true;
							}
						}
					}

					node = parent;
					({ parent } = parent);
				}

				return false;
			}

			const funcNode = getUpperFunction(id);

			return (
				!!funcNode &&
				isInside(funcNode, rightHandSideNode) &&
				isStorableFunction(funcNode, rightHandSideNode)
			);
		}

		const id = ref.identifier;
		const { parent } = id;

		return (
			// in RHS of an assignment for itself. e.g. `a = a + 1`
			ref.isRead() &&
			// self update. e.g. `a += 1`, `a++`
			((parent.type === AST_NODE_TYPES.AssignmentExpression &&
				!LOGICAL_ASSIGNMENT_OPERATORS.has(parent.operator) &&
				isUnusedExpression(parent) &&
				parent.left === id) ||
				(parent.type === AST_NODE_TYPES.UpdateExpression && isUnusedExpression(parent)) ||
				(!!rhsNode && isInside(id, rhsNode) && !isInsideOfStorableFunction(id, rhsNode)))
		);
	}

	const functionNodes = getFunctionDefinitions(variable);
	const isFunctionDefinition = functionNodes.size > 0;

	const typeDeclNodes = getTypeDeclarations(variable);
	const isTypeDecl = typeDeclNodes.size > 0;

	const moduleDeclNodes = getModuleDeclarations(variable);
	const isModuleDecl = moduleDeclNodes.size > 0;

	const enumDeclNodes = getEnumDeclarations(variable);
	const isEnumDecl = enumDeclNodes.size > 0;

	const isImportedAsType = variable.defs.every(isTypeImport);

	let rhsNode: TSESTree.Node | undefined;

	return variable.references.some((ref) => {
		const forItself = isReadForItself(ref, rhsNode);

		rhsNode = getRhsNode(ref, rhsNode);

		return (
			ref.isRead() &&
			!forItself &&
			(isImportedAsType || !referenceContainsTypeQuery(ref.identifier)) &&
			(!isFunctionDefinition || !isSelfReference(ref, functionNodes)) &&
			(!isTypeDecl || !isInsideOneOf(ref, typeDeclNodes)) &&
			(!isModuleDecl || !isSelfReference(ref, moduleDeclNodes)) &&
			(!isEnumDecl || !isSelfReference(ref, enumDeclNodes))
		);
	});
}
