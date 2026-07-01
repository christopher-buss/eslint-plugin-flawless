import * as core from "@eslint-react/core";
import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import { createEslintRule } from "../../util";

export const RULE_NAME = "prefer-destructuring-assignment";

const MESSAGE_ID = "default";

export type MessageIds = typeof MESSAGE_ID;

export type Options = [];

const messages = {
	[MESSAGE_ID]: "Use destructuring assignment for component props.",
};

/**
 * Identifiers that cannot be used as a binding name in strict-mode module code.
 * A property may be accessed with such a name (`props.default`), but a shorthand
 * destructuring pattern built from it (`{ default }`) would be a syntax error,
 * so the autofix bails when one is encountered.
 */
const RESERVED_WORDS = new Set([
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

/**
 * A reference to the props parameter paired with the member expression it is the
 * object of. For a `props.id` usage this pairs the `props` reference with the
 * `props.id` node.
 */
interface MemberReference {
	readonly member: TSESTree.MemberExpression;
	readonly reference: TSESLint.Scope.Reference;
}

/**
 * Collects the unique accessed property names, in first-seen order, when every
 * member reference is a simple non-computed `props.<identifier>` access.
 *
 * @param memberReferences - The member accesses to inspect.
 * @returns The property names, or `null` when any access is not destructurable
 *   (computed access such as `props[key]`, `props` used as a computed key, or a
 *   property whose name is a reserved word that cannot be a binding).
 */
function collectPropertyNames(memberReferences: Array<MemberReference>): Array<string> | null {
	const names: Array<string> = [];
	for (const { member, reference } of memberReferences) {
		if (
			member.object !== reference.identifier ||
			member.computed ||
			member.property.type !== AST_NODE_TYPES.Identifier ||
			RESERVED_WORDS.has(member.property.name)
		) {
			return null;
		}

		if (!names.includes(member.property.name)) {
			names.push(member.property.name);
		}
	}

	return names;
}

/**
 * Determines whether rewriting `props.foo` to `foo` would resolve to a different
 * binding than the new destructured parameter at any access site.
 *
 * A name is unsafe when it is already bound in the component scope (other than by
 * the props parameter itself) or in any scope nested between an access and the
 * component, since the rewritten `foo` reference would then resolve to that
 * binding instead of the destructured prop.
 *
 * @param sourceCode - Provides scope lookup for each reference.
 * @param componentScope - The component function's scope.
 * @param propsVariable - The props parameter variable (excluded from the check).
 * @param memberReferences - The member accesses that would be rewritten.
 * @returns `true` if any rewritten name would collide with an existing binding.
 */
function wouldShadowExistingBinding(
	sourceCode: Readonly<TSESLint.SourceCode>,
	componentScope: TSESLint.Scope.Scope,
	propsVariable: TSESLint.Scope.Variable,
	memberReferences: Array<MemberReference>,
): boolean {
	for (const { member, reference } of memberReferences) {
		const { name } = member.property as TSESTree.Identifier;
		let scope: null | TSESLint.Scope.Scope = sourceCode.getScope(reference.identifier);
		while (scope !== null) {
			const collides = scope.variables.some(
				(variable) => variable.name === name && variable !== propsVariable,
			);
			if (collides) {
				return true;
			}

			if (scope === componentScope) {
				break;
			}

			scope = scope.upper;
		}
	}

	return false;
}

/**
 * Reports every `props.<member>` access on a component's props parameter,
 * attaching an autofix when the parameter can be safely destructured.
 *
 * @param context - The rule context.
 * @param scope - The component function's scope.
 * @param propsParameter - The props parameter identifier.
 * @param propertyVariable - The resolved variable for the props parameter.
 */
function reportComponent(
	context: Readonly<TSESLint.RuleContext<MessageIds, Options>>,
	scope: TSESLint.Scope.Scope,
	propsParameter: TSESTree.Identifier,
	propertyVariable: TSESLint.Scope.Variable,
): void {
	const memberReferences: Array<MemberReference> = [];
	// Any reference that is not a member access (e.g. `{...props}`, passing
	// `props` on) means destructuring the parameter away is unsafe.
	let hasNonMemberReference = false;
	for (const reference of propertyVariable.references) {
		const { parent } = reference.identifier;
		if (parent.type === AST_NODE_TYPES.MemberExpression) {
			memberReferences.push({ member: parent, reference });
		} else {
			hasNonMemberReference = true;
		}
	}

	if (memberReferences.length === 0) {
		return;
	}

	// Report in source order so the first occurrence owns the parameter rewrite.
	memberReferences.sort((left, right) => left.member.range[0] - right.member.range[0]);

	const propertyNames = collectPropertyNames(memberReferences);
	const fixable =
		!hasNonMemberReference &&
		propertyNames !== null &&
		!wouldShadowExistingBinding(context.sourceCode, scope, propertyVariable, memberReferences);

	if (!fixable) {
		for (const { member } of memberReferences) {
			context.report({ messageId: MESSAGE_ID, node: member });
		}

		return;
	}

	// An un-parenthesized single arrow parameter (`props => ...`) needs
	// parentheses to host a destructuring pattern.
	const needsParentheses =
		propsParameter.parent.type === AST_NODE_TYPES.ArrowFunctionExpression &&
		context.sourceCode.getTokenAfter(propsParameter)?.value === "=>";
	const destructured = `{ ${propertyNames.join(", ")} }`;
	const pattern = needsParentheses ? `(${destructured})` : destructured;
	// Preserve any type annotation (`props: Props` -> `{ id }: Props`).
	const nameEnd = propsParameter.typeAnnotation?.range[0] ?? propsParameter.range[1];

	for (const [index, { member }] of memberReferences.entries()) {
		const propertyName = (member.property as TSESTree.Identifier).name;
		context.report({
			fix(fixer) {
				const replaceAccess = fixer.replaceText(member, propertyName);
				// Only the first access rewrites the parameter (with every name),
				// so all fixes are non-overlapping and converge in one pass.
				if (index === 0) {
					return [
						fixer.replaceTextRange([propsParameter.range[0], nameEnd], pattern),
						replaceAccess,
					];
				}

				return replaceAccess;
			},
			messageId: MESSAGE_ID,
			node: member,
		});
	}
}

/**
 * Faithfully ports `react-x/prefer-destructuring-assignment`, removed from
 * `eslint-plugin-react-x` in v5.0.0 (deprecated due to low usage). Component
 * detection is delegated to `@eslint-react/core` so it matches the upstream
 * semantics.
 *
 * Unlike upstream, this port adds an autofix that rewrites the props parameter
 * into a destructuring pattern (`(props) => props.id` becomes `({ id }) => id`).
 * The fix is only offered when it is unambiguously safe; see
 * {@link collectPropertyNames} and {@link wouldShadowExistingBinding}.
 *
 * @param context - The rule context.
 * @returns The rule listener.
 */
function create(
	context: Readonly<TSESLint.RuleContext<MessageIds, Options>>,
): TSESLint.RuleListener {
	const { api, visitor } = core.getFunctionComponentCollector(context);

	return {
		...visitor,
		"Program:exit": function (program: TSESTree.Program): void {
			for (const component of api.getAllComponents(program)) {
				// Anonymous and `export default` components are skipped, matching
				// upstream.
				if (component.name === null || component.isExportDefaultDeclaration) {
					continue;
				}

				const [propsParameter] = component.node.params;
				// A destructured parameter is already the preferred form.
				if (propsParameter?.type !== AST_NODE_TYPES.Identifier) {
					continue;
				}

				const scope = context.sourceCode.getScope(component.node);
				const propertyVariable = scope.variables.find(
					(variable) => variable.name === propsParameter.name,
				);
				if (propertyVariable === undefined) {
					continue;
				}

				reportComponent(context, scope, propsParameter, propertyVariable);
			}
		},
	};
}

export const preferDestructuringAssignment = createEslintRule<Options, MessageIds>({
	name: RULE_NAME,
	create,
	defaultOptions: [],
	meta: {
		docs: {
			description: "Enforce destructuring assignment for component props",
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
