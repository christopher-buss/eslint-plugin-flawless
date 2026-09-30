import { DefinitionType, type ScopeVariable } from "@typescript-eslint/scope-manager";
import {
	AST_NODE_TYPES,
	type JSONSchema,
	type TSESLint,
	type TSESTree,
} from "@typescript-eslint/utils";
import { findVariable } from "@typescript-eslint/utils/ast-utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";

export const RULE_NAME = "prefer-vitest-local-context";

const MESSAGE_ID = "preferLocalContext";

export type MessageIds = typeof MESSAGE_ID;

export interface PreferVitestLocalContextOptions {
	/**
	 * Most parameters a helper may have after the autofix threads fixtures
	 * through it.
	 */
	readonly maxParams?: number;
}

export type Options = [PreferVitestLocalContextOptions?];

const schema: Array<JSONSchema.JSONSchema4> = [
	{
		additionalProperties: false,
		properties: {
			maxParams: {
				description:
					"Most parameters a helper may have after the autofix threads fixtures through it. Past this, the fixtures go in one object parameter; if that also does not fit, the fix is withheld.",
				minimum: 0,
				type: "integer",
			},
		},
		type: "object",
	},
];

type FunctionNode =
	| TSESTree.ArrowFunctionExpression
	| TSESTree.FunctionDeclaration
	| TSESTree.FunctionExpression;

type FixtureName = "expect" | "onTestFailed" | "onTestFinished";

interface FixtureImport {
	readonly name: FixtureName;
	readonly declaration: TSESTree.ImportDeclaration;
	readonly specifier: TSESTree.ImportSpecifier;
	readonly variable: ScopeVariable;
}

interface TestCase {
	readonly callback: FunctionNode;
	readonly contextIndex: number;
	readonly directUses: Map<TSESTree.Identifier, FixtureName>;
	readonly helperCalls: Array<HelperCall>;
}

interface Helper {
	readonly calls: Array<HelperCall>;
	/** Name of an existing `TestContext` parameter, if the helper has one. */
	readonly contextName: null | string;
	readonly directUses: Map<TSESTree.Identifier, FixtureName>;
	/** Fixtures the helper uses, directly or through the helpers it calls. */
	readonly fixtures: Set<FixtureName>;
	readonly node: FunctionNode;
	readonly variable: ScopeVariable;
}

/** How a helper receives its fixtures: one parameter each, or one object. */
type HelperShape = "object" | "separate";

interface HelperCall {
	readonly call: TSESTree.CallExpression;
	readonly helper: Helper;
	readonly owner: FunctionNode | null;
}

interface Edit {
	readonly range: TSESTree.Range;
	readonly text: string;
}

const CONTEXT_FIXTURES = new Set<FixtureName>(["expect", "onTestFailed", "onTestFinished"]);

const TEST_NAMES = new Set(["it", "test"]);

/** Property names that cannot become a shorthand binding in strict code. */
const RESERVED_WORDS: ReadonlySet<string> = new Set([
	"arguments",
	"await",
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"debugger",
	"default",
	"delete",
	"do",
	"else",
	"enum",
	"eval",
	"export",
	"extends",
	"false",
	"finally",
	"for",
	"function",
	"if",
	"implements",
	"import",
	"in",
	"instanceof",
	"interface",
	"let",
	"new",
	"null",
	"package",
	"private",
	"protected",
	"public",
	"return",
	"static",
	"super",
	"switch",
	"this",
	"throw",
	"true",
	"try",
	"typeof",
	"var",
	"void",
	"while",
	"with",
	"yield",
]);

const messages = {
	[MESSAGE_ID]: "Use `{{name}}` from the local Vitest test context instead of the module import.",
};

function isFunction(node: TSESTree.Node | undefined): node is FunctionNode {
	return (
		node?.type === AST_NODE_TYPES.ArrowFunctionExpression ||
		node?.type === AST_NODE_TYPES.FunctionDeclaration ||
		node?.type === AST_NODE_TYPES.FunctionExpression
	);
}

function importedName(specifier: TSESTree.ImportSpecifier): null | string {
	return specifier.imported.type === AST_NODE_TYPES.Identifier
		? specifier.imported.name
		: specifier.imported.value;
}

function rootIdentifier(node: TSESTree.Node): null | TSESTree.Identifier {
	if (node.type === AST_NODE_TYPES.Identifier) {
		return node;
	}

	if (node.type === AST_NODE_TYPES.CallExpression) {
		return rootIdentifier(node.callee);
	}

	if (
		node.type === AST_NODE_TYPES.MemberExpression ||
		node.type === AST_NODE_TYPES.TaggedTemplateExpression
	) {
		return rootIdentifier(
			node.type === AST_NODE_TYPES.MemberExpression ? node.object : node.tag,
		);
	}

	return null;
}

function hasMember(node: TSESTree.Node, name: string): boolean {
	if (node.type === AST_NODE_TYPES.CallExpression) {
		return hasMember(node.callee, name);
	}

	if (node.type === AST_NODE_TYPES.TaggedTemplateExpression) {
		return hasMember(node.tag, name);
	}

	if (node.type !== AST_NODE_TYPES.MemberExpression) {
		return false;
	}

	let propertyName: null | string = null;
	if (!node.computed && node.property.type === AST_NODE_TYPES.Identifier) {
		propertyName = node.property.name;
	} else if (
		node.computed &&
		node.property.type === AST_NODE_TYPES.Literal &&
		typeof node.property.value === "string"
	) {
		propertyName = node.property.value;
	}

	return propertyName === name || hasMember(node.object, name);
}

function isVitestImportDefinition(variable: ScopeVariable, names: ReadonlySet<string>): boolean {
	const definition = variable.defs.at(0);
	if (definition?.type !== DefinitionType.ImportBinding) {
		return false;
	}

	const { node, parent } = definition;
	return (
		parent.type === AST_NODE_TYPES.ImportDeclaration &&
		parent.source.value === "vitest" &&
		node.type === AST_NODE_TYPES.ImportSpecifier &&
		names.has(importedName(node) ?? "")
	);
}

function variableFromIdentifier(
	identifier: TSESTree.Identifier,
	sourceCode: Readonly<TSESLint.SourceCode>,
): null | ScopeVariable {
	return findVariable(sourceCode.getScope(identifier), identifier.name);
}

function isExtendedTestVariable(
	variable: ScopeVariable,
	sourceCode: Readonly<TSESLint.SourceCode>,
	seen: ReadonlySet<ScopeVariable>,
): boolean {
	if (seen.has(variable)) {
		return false;
	}

	if (isVitestImportDefinition(variable, TEST_NAMES)) {
		return true;
	}

	const definition = variable.defs.at(0);
	if (definition?.type !== DefinitionType.Variable) {
		return false;
	}

	const { init } = definition.node;
	if (
		init?.type !== AST_NODE_TYPES.CallExpression ||
		init.callee.type !== AST_NODE_TYPES.MemberExpression ||
		!hasMember(init.callee, "extend")
	) {
		return false;
	}

	const root = rootIdentifier(init.callee.object);
	if (root === null) {
		return false;
	}

	const parent = variableFromIdentifier(root, sourceCode);
	if (parent === null) {
		return false;
	}

	const nextSeen = new Set(seen);
	nextSeen.add(variable);
	return isExtendedTestVariable(parent, sourceCode, nextSeen);
}

function isTestCall(
	call: TSESTree.CallExpression,
	sourceCode: Readonly<TSESLint.SourceCode>,
): boolean {
	const root = rootIdentifier(call.callee);
	if (root === null) {
		return false;
	}

	const variable = variableFromIdentifier(root, sourceCode);
	return variable !== null && isExtendedTestVariable(variable, sourceCode, new Set());
}

function enclosingFunction(node: TSESTree.Node): FunctionNode | null {
	let current: TSESTree.Node | undefined = node.parent;
	while (current !== undefined && current.type !== AST_NODE_TYPES.Program) {
		if (isFunction(current)) {
			return current;
		}

		current = current.parent;
	}

	return null;
}

function functionVariable(
	node: FunctionNode,
	sourceCode: Readonly<TSESLint.SourceCode>,
): null | ScopeVariable {
	if (node.type === AST_NODE_TYPES.FunctionDeclaration && node.id !== null) {
		return variableFromIdentifier(node.id, sourceCode);
	}

	const { parent } = node;
	if (
		parent.type === AST_NODE_TYPES.VariableDeclarator &&
		parent.id.type === AST_NODE_TYPES.Identifier
	) {
		return variableFromIdentifier(parent.id, sourceCode);
	}

	return null;
}

/**
 * Finds a test call's body. Vitest accepts `(name, fn, timeout)` as well as
 * `(name, options, fn)`, so the body is not always the last argument.
 *
 * @param call - The test call.
 * @returns The callback, or `null` when there is none or a spread hides it.
 */
function callbackArgument(call: TSESTree.CallExpression): FunctionNode | null {
	if (call.arguments.some((argument) => argument.type === AST_NODE_TYPES.SpreadElement)) {
		return null;
	}

	const callback = call.arguments.slice(1).findLast((argument) => isFunction(argument));
	return isFunction(callback) ? callback : null;
}

function enclosingTest(
	node: TSESTree.Node,
	tests: ReadonlyMap<FunctionNode, TestCase>,
): null | TestCase {
	let current: TSESTree.Node = node;
	while (current.type !== AST_NODE_TYPES.Program) {
		if (isFunction(current)) {
			const test = tests.get(current);
			if (test !== undefined) {
				return test;
			}
		}

		current = current.parent;
	}

	return null;
}

function directCall(identifier: TSESTree.Identifier): null | TSESTree.CallExpression {
	let current: TSESTree.Node = identifier;
	let { parent } = current;
	while (
		parent.type === AST_NODE_TYPES.TSAsExpression ||
		parent.type === AST_NODE_TYPES.TSNonNullExpression ||
		parent.type === AST_NODE_TYPES.TSTypeAssertion
	) {
		current = parent;
		({ parent } = current);
	}

	return parent.type === AST_NODE_TYPES.CallExpression && parent.callee === current
		? parent
		: null;
}

function existingContextParameter(
	node: FunctionNode,
	sourceCode: Readonly<TSESLint.SourceCode>,
): null | TSESTree.Identifier {
	for (const parameter of node.params) {
		if (parameter.type !== AST_NODE_TYPES.Identifier || parameter.name !== "context") {
			continue;
		}

		const annotation = parameter.typeAnnotation;
		const typeNode = annotation?.typeAnnotation;
		if (
			typeNode?.type === AST_NODE_TYPES.TSTypeReference &&
			typeNode.typeName.type === AST_NODE_TYPES.Identifier
		) {
			const variable = variableFromIdentifier(typeNode.typeName, sourceCode);
			if (variable !== null && isVitestImportDefinition(variable, new Set(["TestContext"]))) {
				return parameter;
			}
		}

		if (
			annotation !== undefined &&
			/\b(?:Vitest)?TestContext\b/u.test(sourceCode.getText(annotation.typeAnnotation))
		) {
			return parameter;
		}
	}

	return null;
}

function freshName(node: FunctionNode, preferred: string, sourceCode: TSESLint.SourceCode): string {
	const names = new Set(sourceCode.getScope(node).variables.map(({ name }) => name));
	if (!names.has(preferred)) {
		return preferred;
	}

	for (let index = 2; ; index += 1) {
		const candidate = `${preferred}${index}`;
		if (!names.has(candidate)) {
			return candidate;
		}
	}
}

/**
 * Determines whether a new binding in a function would shadow nothing the
 * function reads and collide with nothing it declares.
 *
 * @param node - The function that gets the binding.
 * @param name - The binding's name.
 * @param replaced - Variables whose references the fix rewrites, so reads of
 *   them do not count.
 * @param sourceCode - The file's source code.
 * @returns `true` when the name is safe to bind.
 */
function isNameFree(
	node: FunctionNode,
	name: string,
	replaced: ReadonlySet<ScopeVariable>,
	sourceCode: Readonly<TSESLint.SourceCode>,
): boolean {
	const scope = sourceCode.getScope(node);
	const pending = [scope];
	for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
		if (current.set.has(name)) {
			return false;
		}

		pending.push(...current.childScopes);
	}

	return !scope.through.some((reference) => {
		return (
			reference.identifier.name === name &&
			(reference.resolved === null || !replaced.has(reference.resolved))
		);
	});
}

function freeName(
	node: FunctionNode,
	preferred: string,
	replaced: ReadonlySet<ScopeVariable>,
	sourceCode: Readonly<TSESLint.SourceCode>,
): string {
	for (let index = 1; ; index += 1) {
		const candidate = index === 1 ? preferred : `${preferred}${index}`;
		if (isNameFree(node, candidate, replaced, sourceCode)) {
			return candidate;
		}
	}
}

function propertyText(key: string, local: string): string {
	return key === local ? key : `${key}: ${local}`;
}

/**
 * Determines whether a member expression is assigned to, deleted, or
 * otherwise written.
 *
 * @param node - The member expression.
 * @returns `true` when evaluating the parent writes to the node.
 */
function isWriteTarget(node: TSESTree.MemberExpression): boolean {
	const { parent } = node;
	if (
		parent.type === AST_NODE_TYPES.ArrayPattern ||
		parent.type === AST_NODE_TYPES.RestElement ||
		parent.type === AST_NODE_TYPES.UpdateExpression
	) {
		return true;
	}

	if (
		parent.type === AST_NODE_TYPES.AssignmentExpression ||
		parent.type === AST_NODE_TYPES.AssignmentPattern ||
		parent.type === AST_NODE_TYPES.ForInStatement ||
		parent.type === AST_NODE_TYPES.ForOfStatement
	) {
		return parent.left === node;
	}

	if (parent.type === AST_NODE_TYPES.Property) {
		return parent.parent.type === AST_NODE_TYPES.ObjectPattern;
	}

	return parent.type === AST_NODE_TYPES.UnaryExpression && parent.operator === "delete";
}

function addAll(target: Set<FixtureName>, source: ReadonlySet<FixtureName>): boolean {
	const before = target.size;
	for (const fixture of source) {
		target.add(fixture);
	}

	return target.size !== before;
}

function parameterParens(
	node: FunctionNode,
	sourceCode: Readonly<TSESLint.SourceCode>,
): null | { close: TSESTree.Token; open: TSESTree.Token } {
	const boundary =
		node.type === AST_NODE_TYPES.ArrowFunctionExpression
			? sourceCode.getTokenBefore(node.body, (token) => token.value === "=>")
			: sourceCode.getFirstToken(node.body);
	if (boundary === null) {
		return null;
	}

	const tokens = sourceCode
		.getTokens(node)
		.filter((token) => token.range[1] <= boundary.range[0]);
	let depth = 0;
	let close: null | TSESTree.Token = null;
	for (let index = tokens.length - 1; index >= 0; index -= 1) {
		const token = tokens[index];
		if (token?.value === ")") {
			close ??= token;
			depth += 1;
		} else if (token?.value === "(") {
			depth -= 1;
			if (depth === 0 && close !== null) {
				return { close, open: token };
			}
		}
	}

	return null;
}

/**
 * Appends to a parenthesized list, keeping a trailing comma if it has one.
 *
 * @param close - The list's closing parenthesis.
 * @param isEmpty - Whether the list has no items yet.
 * @param text - The items to append.
 * @param sourceCode - The file's source code.
 * @returns The insertion.
 */
function appendToListEdit(
	close: TSESTree.Token,
	isEmpty: boolean,
	text: string,
	sourceCode: Readonly<TSESLint.SourceCode>,
): Edit {
	if (isEmpty) {
		return { range: [close.range[0], close.range[0]], text };
	}

	const previous = sourceCode.getTokenBefore(close);
	if (previous?.value === ",") {
		return { range: [previous.range[1], previous.range[1]], text: ` ${text},` };
	}

	return { range: [close.range[0], close.range[0]], text: `, ${text}` };
}

function addParameterEdit(
	node: FunctionNode,
	text: string,
	sourceCode: Readonly<TSESLint.SourceCode>,
): Edit | null {
	if (node.params.some((parameter) => parameter.type === AST_NODE_TYPES.RestElement)) {
		return null;
	}

	const parens = parameterParens(node, sourceCode);
	if (parens !== null) {
		return appendToListEdit(parens.close, node.params.length === 0, text, sourceCode);
	}

	if (
		node.type === AST_NODE_TYPES.ArrowFunctionExpression &&
		node.params.length === 1 &&
		node.params[0]?.type === AST_NODE_TYPES.Identifier
	) {
		const parameter = node.params[0];
		return {
			range: parameter.range,
			text: `(${sourceCode.getText(parameter)}, ${text})`,
		};
	}

	return null;
}

function insertArgumentEdit(
	call: TSESTree.CallExpression,
	index: number,
	text: string,
	sourceCode: Readonly<TSESLint.SourceCode>,
): Edit | null {
	const argument = call.arguments[index];
	if (argument !== undefined) {
		return { range: [argument.range[0], argument.range[0]], text: `${text}, ` };
	}

	const missing = Array.from({ length: index - call.arguments.length }, () => "undefined");
	const close = sourceCode.getLastToken(call);
	if (close?.value !== ")") {
		return null;
	}

	return appendToListEdit(
		close,
		call.arguments.length === 0,
		[...missing, text].join(", "),
		sourceCode,
	);
}

function patternBinding(pattern: TSESTree.ObjectPattern, fixture: FixtureName): null | string {
	for (const property of pattern.properties) {
		if (
			property.type !== AST_NODE_TYPES.Property ||
			property.computed ||
			property.key.type !== AST_NODE_TYPES.Identifier ||
			property.key.name !== fixture
		) {
			continue;
		}

		if (property.value.type === AST_NODE_TYPES.Identifier) {
			return property.value.name;
		}

		if (
			property.value.type === AST_NODE_TYPES.AssignmentPattern &&
			property.value.left.type === AST_NODE_TYPES.Identifier
		) {
			return property.value.left.name;
		}
	}

	return null;
}

function appendPatternProperties(
	pattern: TSESTree.ObjectPattern,
	properties: ReadonlyArray<string>,
	sourceCode: Readonly<TSESLint.SourceCode>,
): Edit | null {
	const open = sourceCode.getFirstToken(pattern, (token) => token.value === "{");
	const close = sourceCode.getLastToken(pattern, (token) => token.value === "}");
	if (open === null || close === null) {
		return null;
	}

	const interior = sourceCode.text.slice(open.range[1], close.range[0]);
	const content = interior.trimEnd();
	const trailingWhitespace = interior.slice(content.length);
	const separator = content.length === 0 || content.endsWith(",") ? "" : ",";

	return {
		range: [open.range[1], close.range[0]],
		text: `${content}${separator} ${properties.join(", ")}${trailingWhitespace || " "}`,
	};
}

function replacementEdit(identifier: TSESTree.Identifier, text: string): Edit {
	const { name, parent, range } = identifier;
	if (
		text !== name &&
		parent.type === AST_NODE_TYPES.Property &&
		parent.shorthand &&
		parent.value === identifier
	) {
		return { range, text: `${name}: ${text}` };
	}

	return { range, text };
}

function importText(
	declaration: TSESTree.ImportDeclaration,
	namedSpecifiers: ReadonlyArray<string>,
	otherSpecifiers: ReadonlyArray<string>,
	sourceCode: Readonly<TSESLint.SourceCode>,
): string {
	const prefix = declaration.importKind === "type" ? "import type " : "import ";
	const source = sourceCode.getText(declaration.source);
	const tail = sourceCode.text.slice(declaration.source.range[1], declaration.range[1]);
	const named = namedSpecifiers.length === 0 ? "" : `{ ${namedSpecifiers.join(", ")} }`;
	const separator = named.length > 0 && otherSpecifiers.length > 0 ? ", " : "";
	return `${prefix}${otherSpecifiers.join(", ")}${separator}${named} from ${source}${tail}`;
}

function helperShape(helper: Helper, maxParameters: number): HelperShape {
	return helper.node.params.length + helper.fixtures.size <= maxParameters
		? "separate"
		: "object";
}

function helperParameterText(
	shape: HelperShape,
	locals: ReadonlyMap<FixtureName, string>,
	typeName: null | string,
): string {
	const entries = [...locals];
	if (shape === "separate") {
		return entries
			.map(([fixture, local]) => {
				return typeName === null ? local : `${local}: ${typeName}["${fixture}"]`;
			})
			.join(", ");
	}

	const pattern = `{ ${entries.map(([fixture, local]) => propertyText(fixture, local)).join(", ")} }`;
	if (typeName === null) {
		return pattern;
	}

	const keys = entries.map(([fixture]) => `"${fixture}"`).join(" | ");
	return `${pattern}: Pick<${typeName}, ${keys}>`;
}

function typeScriptFile(filename: string): boolean {
	return /\.(?:cts|mts|ts|tsx)$/iu.test(filename);
}

function createOnce(context: FlawlessRuleContext<MessageIds, Options>): FlawlessRuleListener {
	let calls: Array<TSESTree.CallExpression> = [];
	let functions: Array<FunctionNode> = [];
	let fixtureImports: Array<FixtureImport> = [];

	function collectImports(program: TSESTree.Program): void {
		for (const statement of program.body) {
			if (
				statement.type !== AST_NODE_TYPES.ImportDeclaration ||
				statement.source.value !== "vitest"
			) {
				continue;
			}

			for (const specifier of statement.specifiers) {
				if (specifier.type !== AST_NODE_TYPES.ImportSpecifier) {
					continue;
				}

				const name = importedName(specifier);
				if (!CONTEXT_FIXTURES.has(name as FixtureName)) {
					continue;
				}

				const variable = variableFromIdentifier(specifier.local, context.sourceCode);
				if (variable !== null) {
					fixtureImports.push({
						name: name as FixtureName,
						declaration: statement,
						specifier,
						variable,
					});
				}
			}
		}
	}

	function collectTests(): Map<FunctionNode, TestCase> {
		const tests = new Map<FunctionNode, TestCase>();
		for (const call of calls) {
			if (
				!isTestCall(call, context.sourceCode) ||
				hasMember(call.callee, "each") ||
				(call.parent.type === AST_NODE_TYPES.CallExpression && call.parent.callee === call)
			) {
				continue;
			}

			const callback = callbackArgument(call);
			if (callback === null) {
				continue;
			}

			tests.set(callback, {
				callback,
				contextIndex: hasMember(call.callee, "for") ? 1 : 0,
				directUses: new Map(),
				helperCalls: [],
			});
		}

		return tests;
	}

	function importVariables(): Set<ScopeVariable> {
		return new Set(fixtureImports.map(({ variable }) => variable));
	}

	function helperOf(
		owner: FunctionNode | null,
		helpers: ReadonlyMap<ScopeVariable, Helper>,
	): Helper | undefined {
		const variable = owner === null ? null : functionVariable(owner, context.sourceCode);
		return variable === null ? undefined : helpers.get(variable);
	}

	/**
	 * Finds the nearest helper around a node, looking through anonymous
	 * closures such as `forEach` callbacks.
	 *
	 * @param node - The node inside the helper.
	 * @param helpers - Same-file helpers by variable.
	 * @returns The helper, or `undefined` when the node is not in one.
	 */
	function enclosingHelper(
		node: TSESTree.Node,
		helpers: ReadonlyMap<ScopeVariable, Helper>,
	): Helper | undefined {
		for (
			let owner = enclosingFunction(node);
			owner !== null;
			owner = enclosingFunction(owner)
		) {
			const helper = helperOf(owner, helpers);
			if (helper !== undefined) {
				return helper;
			}
		}

		return undefined;
	}

	function collectHelpers(): Map<ScopeVariable, Helper> {
		const helpers = new Map<ScopeVariable, Helper>();
		for (const node of functions) {
			const variable = functionVariable(node, context.sourceCode);
			if (variable === null) {
				continue;
			}

			helpers.set(variable, {
				calls: [],
				contextName: existingContextParameter(node, context.sourceCode)?.name ?? null,
				directUses: new Map(),
				fixtures: new Set(),
				node,
				variable,
			});
		}

		return helpers;
	}

	function assignFixtureUses(
		tests: ReadonlyMap<FunctionNode, TestCase>,
		helpers: ReadonlyMap<ScopeVariable, Helper>,
	): void {
		for (const fixture of fixtureImports) {
			for (const reference of fixture.variable.references) {
				if (!reference.isRead()) {
					continue;
				}

				const { identifier } = reference;
				if (identifier.type !== AST_NODE_TYPES.Identifier) {
					continue;
				}

				const test = enclosingTest(identifier, tests);
				if (test !== null) {
					test.directUses.set(identifier, fixture.name);
					continue;
				}

				const helper = enclosingHelper(identifier, helpers);
				if (helper !== undefined) {
					helper.directUses.set(identifier, fixture.name);
					helper.fixtures.add(fixture.name);
				}
			}
		}
	}

	function collectHelperCalls(
		tests: ReadonlyMap<FunctionNode, TestCase>,
		helpers: ReadonlyMap<ScopeVariable, Helper>,
	): void {
		for (const helper of helpers.values()) {
			for (const reference of helper.variable.references) {
				if (!reference.isRead()) {
					continue;
				}

				if (reference.identifier.type !== AST_NODE_TYPES.Identifier) {
					continue;
				}

				const call = directCall(reference.identifier);
				if (call === null) {
					continue;
				}

				const test = enclosingTest(reference.identifier, tests);
				const owner =
					test?.callback ??
					enclosingHelper(reference.identifier, helpers)?.node ??
					enclosingFunction(reference.identifier);
				const helperCall = { call, helper, owner };
				helper.calls.push(helperCall);
				if (test !== null) {
					test.helperCalls.push(helperCall);
				}
			}
		}
	}

	/**
	 * Adds each helper's fixtures to the helpers that call it, since a caller
	 * must pass those fixtures on.
	 *
	 * @param tests - Test callbacks by node.
	 * @param helpers - Same-file helpers by variable.
	 */
	function propagateFixtures(
		tests: ReadonlyMap<FunctionNode, TestCase>,
		helpers: ReadonlyMap<ScopeVariable, Helper>,
	): void {
		let changed = true;
		while (changed) {
			changed = false;
			for (const helper of helpers.values()) {
				if (helper.contextName !== null) {
					continue;
				}

				for (const call of helper.calls) {
					if (call.owner === null || tests.has(call.owner)) {
						continue;
					}

					const caller = helperOf(call.owner, helpers);
					if (caller !== undefined && addAll(caller.fixtures, helper.fixtures)) {
						changed = true;
					}
				}
			}
		}
	}

	function helpersAreFixable(
		tests: ReadonlyMap<FunctionNode, TestCase>,
		helpers: ReadonlyMap<ScopeVariable, Helper>,
		activeHelpers: ReadonlySet<Helper>,
		maxParameters: number,
	): boolean {
		for (const helper of activeHelpers) {
			if (helper.contextName !== null) {
				continue;
			}

			if (helper.node.params.length + 1 > maxParameters) {
				return false;
			}

			if (
				helper.node.params.some((parameter) => {
					return (
						parameter.type === AST_NODE_TYPES.RestElement ||
						(parameter.type === AST_NODE_TYPES.Identifier && parameter.optional)
					);
				})
			) {
				return false;
			}

			let declaration: TSESTree.Node = helper.node;
			if (helper.node.type !== AST_NODE_TYPES.FunctionDeclaration) {
				const { parent } = helper.node;
				if (parent.type === AST_NODE_TYPES.VariableDeclarator) {
					declaration = parent.parent;
				}
			}

			if (declaration.parent.type.startsWith("Export")) {
				return false;
			}

			for (const reference of helper.variable.references) {
				if (!reference.isRead()) {
					continue;
				}

				if (reference.identifier.type !== AST_NODE_TYPES.Identifier) {
					return false;
				}

				const call = directCall(reference.identifier);
				if (
					call === null ||
					call.arguments.some(
						(argument) => argument.type === AST_NODE_TYPES.SpreadElement,
					)
				) {
					return false;
				}

				const test = enclosingTest(reference.identifier, tests);
				if (test !== null) {
					continue;
				}

				const caller = enclosingHelper(reference.identifier, helpers);
				if (caller === undefined || !activeHelpers.has(caller)) {
					return false;
				}
			}
		}

		return true;
	}

	function reachableHelpers(
		tests: ReadonlyMap<FunctionNode, TestCase>,
		helpers: ReadonlyMap<ScopeVariable, Helper>,
	): Set<Helper> {
		const reachable = new Set<Helper>();
		for (const helper of helpers.values()) {
			if (helper.contextName !== null && helper.fixtures.size > 0) {
				reachable.add(helper);
			}
		}

		for (const test of tests.values()) {
			for (const { helper } of test.helperCalls) {
				if (helper.fixtures.size > 0) {
					reachable.add(helper);
				}
			}
		}

		let changed = true;
		while (changed) {
			changed = false;
			for (const helper of helpers.values()) {
				if (helper.fixtures.size === 0 || reachable.has(helper)) {
					continue;
				}

				if (
					helper.calls.some(
						({ owner }) =>
							owner !== null && [...reachable].some(({ node }) => node === owner),
					)
				) {
					reachable.add(helper);
					changed = true;
				}
			}
		}

		return reachable;
	}

	/**
	 * Rewrites a whole-context parameter to a destructuring pattern when the
	 * body only reads plain `context.name` properties from it.
	 *
	 * @param callback - The test callback.
	 * @param parameter - Its context parameter.
	 * @param fixtures - Fixtures the test needs bound.
	 * @param edits - Receives the rewrite.
	 * @returns Local names by fixture, or `null` when the context cannot be
	 *   destructured.
	 */
	function destructureContext(
		callback: FunctionNode,
		parameter: TSESTree.Identifier,
		fixtures: ReadonlySet<FixtureName>,
		edits: Array<Edit>,
	): Map<FixtureName, string> | null {
		const variable = context.sourceCode.getScope(callback).set.get(parameter.name);
		if (parameter.optional || variable === undefined) {
			return null;
		}

		const members: Array<{ key: string; node: TSESTree.MemberExpression }> = [];
		for (const reference of variable.references) {
			const { parent } = reference.identifier;
			if (
				parent.type !== AST_NODE_TYPES.MemberExpression ||
				parent.object !== reference.identifier ||
				parent.computed ||
				parent.property.type !== AST_NODE_TYPES.Identifier ||
				isWriteTarget(parent)
			) {
				return null;
			}

			members.push({ key: parent.property.name, node: parent });
		}

		const keys = new Set<string>([...fixtures, ...members.map(({ key }) => key)]);
		if ([...keys].some((key) => RESERVED_WORDS.has(key))) {
			return null;
		}

		const replaced = importVariables();
		for (const key of keys) {
			if (!isNameFree(callback, key, replaced, context.sourceCode)) {
				return null;
			}
		}

		const pattern = `{ ${[...keys].toSorted().join(", ")} }`;
		const parenthesized = parameterParens(callback, context.sourceCode) !== null;
		edits.push({
			range: [parameter.range[0], parameter.range[0] + parameter.name.length],
			text: parenthesized ? pattern : `(${pattern})`,
		});
		for (const { key, node } of members) {
			edits.push({ range: node.range, text: key });
		}

		return new Map([...fixtures].map((fixture) => [fixture, fixture]));
	}

	/**
	 * Binds each fixture in the test callback.
	 *
	 * @param test - The test being fixed.
	 * @param test.callback - Its callback.
	 * @param test.contextIndex - Position of the context parameter.
	 * @param fixtures - Fixtures to bind.
	 * @param edits - Receives the bindings.
	 * @returns Local names by fixture, or `null` when they cannot be bound.
	 */
	function testBindings(
		{ callback, contextIndex }: TestCase,
		fixtures: ReadonlySet<FixtureName>,
		edits: Array<Edit>,
	): Map<FixtureName, string> | null {
		const replaced = importVariables();
		const bindings = new Map<FixtureName, string>();
		const parameter = callback.params[contextIndex];

		if (parameter === undefined) {
			const properties = [...fixtures].toSorted().map((fixture) => {
				const local = freeName(callback, fixture, replaced, context.sourceCode);
				bindings.set(fixture, local);
				return propertyText(fixture, local);
			});
			const prefix =
				contextIndex === 1 && callback.params.length === 0
					? `${freshName(callback, "_value", context.sourceCode)}, `
					: "";
			const edit = addParameterEdit(
				callback,
				`${prefix}{ ${properties.join(", ")} }`,
				context.sourceCode,
			);
			if (edit === null) {
				return null;
			}

			edits.push(edit);
			return bindings;
		}

		if (parameter.type === AST_NODE_TYPES.Identifier) {
			const { name } = parameter;
			return (
				destructureContext(callback, parameter, fixtures, edits) ??
				new Map([...fixtures].map((fixture) => [fixture, `${name}.${fixture}`]))
			);
		}

		if (
			parameter.type !== AST_NODE_TYPES.ObjectPattern ||
			parameter.properties.some(({ type }) => type === AST_NODE_TYPES.RestElement)
		) {
			return null;
		}

		const additions: Array<string> = [];
		for (const fixture of [...fixtures].toSorted()) {
			const existing = patternBinding(parameter, fixture);
			if (existing !== null) {
				bindings.set(fixture, existing);
				continue;
			}

			const local = freeName(callback, fixture, replaced, context.sourceCode);
			bindings.set(fixture, local);
			additions.push(propertyText(fixture, local));
		}

		if (additions.length > 0) {
			const edit = appendPatternProperties(parameter, additions, context.sourceCode);
			if (edit === null) {
				return null;
			}

			edits.push(edit);
		}

		return bindings;
	}

	function argumentText(
		helper: Helper,
		shape: HelperShape,
		callerBindings: ReadonlyMap<FixtureName, string> | undefined,
	): null | string {
		const values: Array<[FixtureName, string]> = [];
		for (const fixture of [...helper.fixtures].toSorted()) {
			const value = callerBindings?.get(fixture);
			if (value === undefined) {
				return null;
			}

			values.push([fixture, value]);
		}

		if (shape === "separate") {
			return values.map(([, value]) => value).join(", ");
		}

		return `{ ${values.map(([fixture, value]) => propertyText(fixture, value)).join(", ")} }`;
	}

	function buildEdits(
		tests: ReadonlyMap<FunctionNode, TestCase>,
		activeHelpers: ReadonlySet<Helper>,
		maxParameters: number,
	): Array<Edit> | null {
		const edits: Array<Edit> = [];
		const replaced = new Set<TSESTree.Identifier>();
		const existingContextImport = context.sourceCode.ast.body
			.filter((statement): statement is TSESTree.ImportDeclaration => {
				return (
					statement.type === AST_NODE_TYPES.ImportDeclaration &&
					statement.source.value === "vitest"
				);
			})
			.flatMap(({ specifiers }) => specifiers)
			.find((specifier): specifier is TSESTree.ImportSpecifier => {
				return (
					specifier.type === AST_NODE_TYPES.ImportSpecifier &&
					importedName(specifier) === "TestContext"
				);
			});
		const typeName = typeScriptFile(context.filename)
			? (existingContextImport?.local.name ?? "TestContext")
			: null;
		const importedFixtures = importVariables();

		const bindings = new Map<Helper, Map<FixtureName, string>>();
		for (const helper of activeHelpers) {
			const fixtures = [...helper.fixtures].toSorted();
			const { contextName } = helper;
			if (contextName !== null) {
				bindings.set(
					helper,
					new Map(fixtures.map((fixture) => [fixture, `${contextName}.${fixture}`])),
				);
				continue;
			}

			const { node } = helper;
			const locals = new Map(
				fixtures.map((fixture) => {
					return [fixture, freeName(node, fixture, importedFixtures, context.sourceCode)];
				}),
			);
			const edit = addParameterEdit(
				node,
				helperParameterText(helperShape(helper, maxParameters), locals, typeName),
				context.sourceCode,
			);
			if (edit === null) {
				return null;
			}

			edits.push(edit);
			bindings.set(helper, locals);
		}

		for (const helper of activeHelpers) {
			for (const [identifier, fixture] of helper.directUses) {
				const text = bindings.get(helper)?.get(fixture);
				if (text === undefined) {
					return null;
				}

				edits.push(replacementEdit(identifier, text));
				replaced.add(identifier);
			}

			if (helper.contextName !== null) {
				continue;
			}

			for (const helperCall of helper.calls) {
				const caller = [...activeHelpers].find(({ node }) => node === helperCall.owner);
				if (caller === undefined) {
					continue;
				}

				const text = argumentText(
					helper,
					helperShape(helper, maxParameters),
					bindings.get(caller),
				);
				if (text === null) {
					return null;
				}

				const edit = insertArgumentEdit(
					helperCall.call,
					helper.node.params.length,
					text,
					context.sourceCode,
				);
				if (edit === null) {
					return null;
				}

				edits.push(edit);
			}
		}

		for (const test of tests.values()) {
			const helperCalls = test.helperCalls.filter(({ helper }) => {
				return activeHelpers.has(helper) && helper.contextName === null;
			});
			const fixtures = new Set(test.directUses.values());
			for (const { helper } of helperCalls) {
				for (const fixture of helper.fixtures) {
					fixtures.add(fixture);
				}
			}

			if (fixtures.size === 0) {
				continue;
			}

			const testLocals = testBindings(test, fixtures, edits);
			if (testLocals === null) {
				return null;
			}

			for (const [identifier, fixture] of test.directUses) {
				const text = testLocals.get(fixture);
				if (text === undefined) {
					return null;
				}

				edits.push(replacementEdit(identifier, text));
				replaced.add(identifier);
			}

			for (const { call, helper } of helperCalls) {
				const text = argumentText(helper, helperShape(helper, maxParameters), testLocals);
				if (text === null) {
					return null;
				}

				const edit = insertArgumentEdit(
					call,
					helper.node.params.length,
					text,
					context.sourceCode,
				);
				if (edit === null) {
					return null;
				}

				edits.push(edit);
			}
		}

		const removable = new Map<TSESTree.ImportDeclaration, Set<TSESTree.ImportSpecifier>>();
		for (const fixture of fixtureImports) {
			if (
				fixture.variable.references.length > 0 &&
				fixture.variable.references.every(
					({ identifier }) =>
						identifier.type === AST_NODE_TYPES.Identifier && replaced.has(identifier),
				)
			) {
				const specifiers = removable.get(fixture.declaration) ?? new Set();
				specifiers.add(fixture.specifier);
				removable.set(fixture.declaration, specifiers);
			}
		}

		const needsTypeImport =
			typeName !== null && [...activeHelpers].some(({ contextName }) => contextName === null);
		let addedTypeImport = existingContextImport !== undefined;
		for (const [declaration, removed] of removable) {
			const remaining = declaration.specifiers.filter(
				(specifier) => !removed.has(specifier as TSESTree.ImportSpecifier),
			);
			const named = remaining.filter((specifier): specifier is TSESTree.ImportSpecifier => {
				return specifier.type === AST_NODE_TYPES.ImportSpecifier;
			});
			const others = remaining.filter(
				(specifier) => specifier.type !== AST_NODE_TYPES.ImportSpecifier,
			);
			const otherTexts = others.map((specifier) => context.sourceCode.getText(specifier));

			const texts = named.map((specifier) => context.sourceCode.getText(specifier));
			if (
				needsTypeImport &&
				!addedTypeImport &&
				others.every(
					(specifier) => specifier.type === AST_NODE_TYPES.ImportDefaultSpecifier,
				) &&
				!named.some((specifier) => importedName(specifier) === "TestContext")
			) {
				texts.push(declaration.importKind === "type" ? "TestContext" : "type TestContext");
				addedTypeImport = true;
			}

			if (texts.length === 0 && otherTexts.length === 0) {
				const lineEnd = context.sourceCode.text.indexOf("\n", declaration.range[1]);
				edits.push({
					range: [
						declaration.range[0],
						lineEnd === -1 ? declaration.range[1] : lineEnd + 1,
					],
					text: "",
				});
			} else {
				edits.push({
					range: declaration.range,
					text: importText(declaration, texts, otherTexts, context.sourceCode),
				});
			}
		}

		if (needsTypeImport && !addedTypeImport) {
			const first = context.sourceCode.ast.body.at(0);
			edits.push({
				range: first?.range ?? [0, 0],
				text: 'import type { TestContext } from "vitest";\n',
			});
		}

		const ordered = edits.toSorted(
			(left, right) => left.range[0] - right.range[0] || left.range[1] - right.range[1],
		);
		for (let index = 1; index < ordered.length; index += 1) {
			const previous = ordered[index - 1];
			const current = ordered[index];
			if (
				previous !== undefined &&
				current !== undefined &&
				previous.range[1] > current.range[0]
			) {
				return null;
			}
		}

		return ordered;
	}

	function analyze(program: TSESTree.Program): void {
		collectImports(program);
		if (fixtureImports.length === 0) {
			return;
		}

		const maxParameters = context.options[0]?.maxParams ?? Number.POSITIVE_INFINITY;
		const tests = collectTests();
		const helpers = collectHelpers();
		assignFixtureUses(tests, helpers);
		collectHelperCalls(tests, helpers);
		propagateFixtures(tests, helpers);
		const reachable = reachableHelpers(tests, helpers);
		const relevant = [
			...[...tests.values()].flatMap(({ directUses }) => [...directUses.keys()]),
			...[...reachable].flatMap(({ directUses }) => [...directUses.keys()]),
		];
		if (relevant.length === 0) {
			return;
		}

		const activeHelpers = helpersAreFixable(tests, helpers, reachable, maxParameters)
			? reachable
			: new Set<Helper>();
		const edits = buildEdits(tests, activeHelpers, maxParameters);
		for (const [index, identifier] of relevant.entries()) {
			const fixture = fixtureImports.find(({ variable }) => {
				return variable.references.some((reference) => reference.identifier === identifier);
			});
			context.report({
				data: { name: fixture?.name ?? identifier.name },
				fix(fixer) {
					if (index !== 0 || edits === null) {
						return null;
					}

					return edits.map((edit) => fixer.replaceTextRange(edit.range, edit.text));
				},
				messageId: MESSAGE_ID,
				node: identifier,
			});
		}
	}

	return {
		"ArrowFunctionExpression": function (node): void {
			functions.push(node);
		},
		"before": function (): void {
			calls = [];
			fixtureImports = [];
			functions = [];
		},
		"CallExpression": function (node): void {
			calls.push(node);
		},
		"FunctionDeclaration": function (node): void {
			functions.push(node);
		},
		"FunctionExpression": function (node): void {
			functions.push(node);
		},
		"Program:exit": analyze,
	};
}

export const preferVitestLocalContext = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [{}],
	meta: {
		defaultOptions: [{}],
		docs: {
			description: "Prefer test-bound Vitest APIs from the local test context",
			recommended: false,
			requiresTypeChecking: false,
		},
		fixable: "code",
		hasSuggestions: false,
		messages,
		schema,
		type: "suggestion",
	},
});
