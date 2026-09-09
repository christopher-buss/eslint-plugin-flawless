import { DefinitionType, type ScopeVariable } from "@typescript-eslint/scope-manager";
import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";
import { findVariable } from "@typescript-eslint/utils/ast-utils";

import type { FlawlessRuleContext, FlawlessRuleListener } from "../../util";
import { createFlawlessRule } from "../../util";

export const RULE_NAME = "prefer-vitest-local-context";

const MESSAGE_ID = "preferLocalContext";

export type MessageIds = typeof MESSAGE_ID;
export type Options = [];

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
	contextName: string;
	readonly directUses: Map<TSESTree.Identifier, FixtureName>;
	hasContext: boolean;
	needsContext: boolean;
	readonly node: FunctionNode;
	readonly variable: ScopeVariable;
}

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
	return findVariable(sourceCode.getScope(identifier), identifier);
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

function callbackArgument(call: TSESTree.CallExpression): FunctionNode | null {
	for (let index = call.arguments.length - 1; index >= 0; index -= 1) {
		const argument = call.arguments[index];
		if (argument !== undefined && argument.type !== AST_NODE_TYPES.SpreadElement) {
			if (isFunction(argument)) {
				return argument;
			}

			return null;
		}
	}

	return null;
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
		return {
			range: [parens.close.range[0], parens.close.range[0]],
			text: node.params.length === 0 ? text : `, ${text}`,
		};
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

function insertArgumentEdit(call: TSESTree.CallExpression, index: number, text: string): Edit {
	const argument = call.arguments[index];
	if (argument !== undefined) {
		return { range: [argument.range[0], argument.range[0]], text: `${text}, ` };
	}

	const missing = Array.from({ length: index - call.arguments.length }, () => "undefined");
	const argumentsToAdd = [...missing, text].join(", ");
	const [, end] = call.range;
	return {
		range: [end - 1, end - 1],
		text: call.arguments.length === 0 ? argumentsToAdd : `, ${argumentsToAdd}`,
	};
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

	function collectHelpers(): Map<ScopeVariable, Helper> {
		const helpers = new Map<ScopeVariable, Helper>();
		for (const node of functions) {
			const variable = functionVariable(node, context.sourceCode);
			if (variable === null) {
				continue;
			}

			const existing = existingContextParameter(node, context.sourceCode);
			helpers.set(variable, {
				calls: [],
				contextName: existing?.name ?? freshName(node, "context", context.sourceCode),
				directUses: new Map(),
				hasContext: existing !== null,
				needsContext: false,
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

				const owner = enclosingFunction(identifier);
				const variable =
					owner === null ? null : functionVariable(owner, context.sourceCode);
				const helper = variable === null ? undefined : helpers.get(variable);
				if (helper !== undefined) {
					helper.directUses.set(identifier, fixture.name);
					helper.needsContext = true;
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
				const owner = test?.callback ?? enclosingFunction(reference.identifier);
				const helperCall = { call, helper, owner };
				helper.calls.push(helperCall);
				if (test !== null) {
					test.helperCalls.push(helperCall);
				}
			}
		}
	}

	function propagateContext(
		tests: ReadonlyMap<FunctionNode, TestCase>,
		helpers: ReadonlyMap<ScopeVariable, Helper>,
	): void {
		let changed = true;
		while (changed) {
			changed = false;
			for (const helper of helpers.values()) {
				if (!helper.needsContext || helper.hasContext) {
					continue;
				}

				for (const call of helper.calls) {
					if (call.owner === null || tests.has(call.owner)) {
						continue;
					}

					const variable = functionVariable(call.owner, context.sourceCode);
					const caller = variable === null ? undefined : helpers.get(variable);
					if (caller !== undefined && !caller.needsContext) {
						caller.needsContext = true;
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
	): boolean {
		for (const helper of activeHelpers) {
			if (helper.hasContext) {
				continue;
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

				const owner = enclosingFunction(reference.identifier);
				const variable =
					owner === null ? null : functionVariable(owner, context.sourceCode);
				const caller = variable === null ? undefined : helpers.get(variable);
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
			if (helper.hasContext && helper.needsContext) {
				reachable.add(helper);
			}
		}

		for (const test of tests.values()) {
			for (const { helper } of test.helperCalls) {
				if (helper.needsContext) {
					reachable.add(helper);
				}
			}
		}

		let changed = true;
		while (changed) {
			changed = false;
			for (const helper of helpers.values()) {
				if (!helper.needsContext || reachable.has(helper)) {
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

	function contextParameter(
		test: TestCase,
		needsWholeContext: boolean,
		edits: Array<Edit>,
	): null | { bindings: Map<FixtureName, string>; name: null | string } {
		function addContextParameter(text: string): Edit | null {
			const prefix =
				test.contextIndex === 1 && test.callback.params.length === 0
					? `${freshName(test.callback, "_value", context.sourceCode)}, `
					: "";
			return addParameterEdit(test.callback, `${prefix}${text}`, context.sourceCode);
		}

		const parameter = test.callback.params[test.contextIndex];
		if (needsWholeContext) {
			if (parameter?.type === AST_NODE_TYPES.Identifier) {
				return { name: parameter.name, bindings: new Map() };
			}

			const name = freshName(test.callback, "context", context.sourceCode);
			if (parameter === undefined) {
				const edit = addContextParameter(name);
				if (edit === null) {
					return null;
				}

				edits.push(edit);
				return { name, bindings: new Map() };
			}

			if (
				parameter.type !== AST_NODE_TYPES.ObjectPattern ||
				test.callback.body.type !== AST_NODE_TYPES.BlockStatement
			) {
				return null;
			}

			const annotationStart = parameter.typeAnnotation?.range[0] ?? parameter.range[1];
			const pattern = context.sourceCode.text
				.slice(parameter.range[0], annotationStart)
				.trimEnd();
			edits.push({ range: parameter.range, text: name });
			const openBrace = context.sourceCode.getFirstToken(test.callback.body);
			if (openBrace === null) {
				return null;
			}

			const first = test.callback.body.body.at(0);
			if (first === undefined) {
				edits.push({
					range: [openBrace.range[1], openBrace.range[1]],
					text: `\n\tconst ${pattern} = ${name};\n`,
				});
			} else {
				const indentation = context.sourceCode.text.slice(
					context.sourceCode.getIndexFromLoc({
						column: 0,
						line: first.loc.start.line,
					}),
					first.range[0],
				);
				edits.push({
					range: [first.range[0], first.range[0]],
					text: `const ${pattern} = ${name};\n${indentation}`,
				});
			}

			return { name, bindings: new Map() };
		}

		if (parameter?.type === AST_NODE_TYPES.Identifier) {
			return { name: parameter.name, bindings: new Map() };
		}

		const fixtures = new Set(test.directUses.values());
		const bindings = new Map<FixtureName, string>();
		if (parameter?.type === AST_NODE_TYPES.ObjectPattern) {
			const additions: Array<string> = [];
			for (const fixture of fixtures) {
				const existing = patternBinding(parameter, fixture);
				if (existing !== null) {
					bindings.set(fixture, existing);
					continue;
				}

				const local = freshName(test.callback, fixture, context.sourceCode);
				bindings.set(fixture, local);
				additions.push(local === fixture ? fixture : `${fixture}: ${local}`);
			}

			if (additions.length > 0) {
				const edit = appendPatternProperties(parameter, additions, context.sourceCode);
				if (edit === null) {
					return null;
				}

				edits.push(edit);
			}

			return { name: null, bindings };
		}

		if (parameter !== undefined) {
			return null;
		}

		const properties = [...fixtures].map((fixture) => {
			const local = freshName(test.callback, fixture, context.sourceCode);
			bindings.set(fixture, local);
			return local === fixture ? fixture : `${fixture}: ${local}`;
		});
		const edit = addContextParameter(`{ ${properties.join(", ")} }`);
		if (edit === null) {
			return null;
		}

		edits.push(edit);
		return { name: null, bindings };
	}

	function buildEdits(
		tests: ReadonlyMap<FunctionNode, TestCase>,
		activeHelpers: ReadonlySet<Helper>,
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
		const contextTypeName = existingContextImport?.local.name ?? "TestContext";

		for (const helper of activeHelpers) {
			if (!helper.hasContext) {
				const type = typeScriptFile(context.filename) ? `: ${contextTypeName}` : "";
				const edit = addParameterEdit(
					helper.node,
					`${helper.contextName}${type}`,
					context.sourceCode,
				);
				if (edit === null) {
					return null;
				}

				edits.push(edit);
			}

			for (const [identifier, fixture] of helper.directUses) {
				edits.push(replacementEdit(identifier, `${helper.contextName}.${fixture}`));
				replaced.add(identifier);
			}
		}

		for (const test of tests.values()) {
			const helperCalls = test.helperCalls.filter(
				({ helper }) => activeHelpers.has(helper) && !helper.hasContext,
			);
			if (test.directUses.size === 0 && helperCalls.length === 0) {
				continue;
			}

			const parameter = contextParameter(test, helperCalls.length > 0, edits);
			if (parameter === null) {
				return null;
			}

			for (const [identifier, fixture] of test.directUses) {
				const replacement =
					parameter.name === null
						? parameter.bindings.get(fixture)
						: `${parameter.name}.${fixture}`;
				if (replacement === undefined) {
					return null;
				}

				edits.push(replacementEdit(identifier, replacement));
				replaced.add(identifier);
			}

			if (parameter.name !== null) {
				for (const helperCall of helperCalls) {
					if (!helperCall.helper.hasContext) {
						edits.push(
							insertArgumentEdit(
								helperCall.call,
								helperCall.helper.node.params.length,
								parameter.name,
							),
						);
					}
				}
			}
		}

		for (const caller of activeHelpers) {
			for (const helper of activeHelpers) {
				for (const helperCall of helper.calls) {
					if (helperCall.owner !== caller.node || helper.hasContext) {
						continue;
					}

					edits.push(
						insertArgumentEdit(
							helperCall.call,
							helper.node.params.length,
							caller.contextName,
						),
					);
				}
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
			typeScriptFile(context.filename) &&
			[...activeHelpers].some(({ hasContext }) => !hasContext);
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

		const ordered = edits.toSorted((left, right) => left.range[0] - right.range[0]);
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

		const tests = collectTests();
		const helpers = collectHelpers();
		assignFixtureUses(tests, helpers);
		collectHelperCalls(tests, helpers);
		propagateContext(tests, helpers);
		const reachable = reachableHelpers(tests, helpers);
		const relevant = [
			...[...tests.values()].flatMap(({ directUses }) => [...directUses.keys()]),
			...[...reachable].flatMap(({ directUses }) => [...directUses.keys()]),
		];
		if (relevant.length === 0) {
			return;
		}

		const activeHelpers = helpersAreFixable(tests, helpers, reachable)
			? reachable
			: new Set<Helper>();
		const edits = buildEdits(tests, activeHelpers);
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
	defaultOptions: [],
	meta: {
		docs: {
			description: "Prefer test-bound Vitest APIs from the local test context",
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
