import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

import { getStaticJSONValue } from "jsonc-eslint-parser";
import type { AST } from "jsonc-eslint-parser";
import path from "node:path";

import { createEslintRule } from "../../util";
import type { JsonContext, JsonSourceCode } from "../../utils/types";
import { buildInheritedConfig, type InheritedEntry, isRecord } from "./resolve-extends";

export const RULE_NAME = "no-redundant-tsconfig-options";

const MESSAGE_ID = "redundant";

export type MessageIds = typeof MESSAGE_ID;

export type Options = [];

/**
 * Compiler options TypeScript resolves case-insensitively; a child that re-sets
 * one differing only in case is still redundant.
 */
const ENUM_SCALAR_KEYS = new Set([
	"jsx",
	"module",
	"moduleDetection",
	"moduleResolution",
	"newLine",
	"target",
]);

/**
 * `compilerOptions` keys whose values are resolved as paths relative to the
 * config that declares them. An identical value repeated in a child in a
 * different directory means a different path, so these are only redundant when
 * the value is location-independent (see {@link isLocationIndependent}).
 */
const PATH_KEYS = new Set([
	"baseUrl",
	"declarationDir",
	"outDir",
	"outFile",
	"paths",
	"rootDir",
	"rootDirs",
	"tsBuildInfoFile",
	"typeRoots",
]);

const messages = {
	[MESSAGE_ID]:
		"'{{option}}' is redundant: it is already set to this value by {{source}}. Remove it.",
};

/**
 * Structural equality between two static JSON values. Strings compare
 * case-insensitively when `caseInsensitive` is set (used for enum-valued
 * options and `lib` entries, which TypeScript itself folds).
 *
 * @param a - The child's value.
 * @param b - The inherited value.
 * @param caseInsensitive - Whether string scalars compare case-insensitively.
 * @returns Whether the two values are equal.
 */
function equalValues(a: unknown, b: unknown, caseInsensitive: boolean): boolean {
	if (typeof a === "string" && typeof b === "string") {
		return caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b;
	}

	if (Array.isArray(a) && Array.isArray(b)) {
		return (
			a.length === b.length &&
			a.every((item, index) => equalValues(item, b[index], caseInsensitive))
		);
	}

	if (isRecord(a) && isRecord(b)) {
		const aKeys = Object.keys(a);
		const bKeys = Object.keys(b);
		return (
			aKeys.length === bKeys.length &&
			aKeys.every((key) => key in b && equalValues(a[key], b[key], caseInsensitive))
		);
	}

	return a === b;
}

/**
 * Whether a path-valued option is location-independent — every path string it
 * contains is either `${configDir}`-anchored (re-anchored to the extending
 * config, so an identical value resolves to the same files) or absolute. Only
 * then is repeating a path option genuinely redundant.
 *
 * @param value - The option value.
 * @returns Whether the value resolves the same regardless of config location.
 */
function isLocationIndependent(value: unknown): boolean {
	if (typeof value === "string") {
		// eslint-disable-next-line no-template-curly-in-string -- literal tsconfig token
		return value.includes("${configDir}") || path.isAbsolute(value);
	}

	if (Array.isArray(value)) {
		return value.every((item) => isLocationIndependent(item));
	}

	if (isRecord(value)) {
		return Object.values(value).every((item) => isLocationIndependent(item));
	}

	// A non-path-shaped value (e.g. a boolean) can't be location-dependent.
	return true;
}

/**
 * Whether a child option re-setting `inherited` to `childValue` is redundant:
 * the values are equal and, for path-valued options, location-independent.
 *
 * @param key - The option name.
 * @param childValue - The value the child sets.
 * @param inherited - The inherited value.
 * @param isPathKey - Whether the key is path-valued.
 * @returns Whether the child option is redundant.
 */
function isRedundant(
	key: string,
	childValue: unknown,
	inherited: unknown,
	isPathKey: boolean,
): boolean {
	const caseInsensitive = key === "lib" || ENUM_SCALAR_KEYS.has(key);
	if (!equalValues(childValue, inherited, caseInsensitive)) {
		return false;
	}

	return !isPathKey || isLocationIndependent(childValue);
}

function keyName({ key }: AST.JSONProperty): string {
	return key.type === "JSONIdentifier" ? key.name : String(getStaticJSONValue(key));
}

function findProperty(
	object: AST.JSONObjectExpression,
	name: string,
): AST.JSONProperty | undefined {
	return object.properties.find((property) => keyName(property) === name);
}

function create(context: JsonContext<MessageIds, Options>): TSESLint.RuleListener {
	const { sourceCode } = context;
	if (sourceCode.parserServices.isJSON !== true) {
		return {};
	}

	const { filename } = context;
	// `createRequire` and the parent `fs` reads need a real absolute path;
	// `<input>`/virtual filenames resolve against nothing meaningful.
	if (!path.isAbsolute(filename)) {
		return {};
	}

	/**
	 * Reports a redundant property, removing it (with its delimiter comma) unless
	 * a comment is attached, in which case it reports without a fix to avoid
	 * stranding the comment.
	 *
	 * @param property - The redundant property node.
	 * @param name - The property's key name (already computed by the caller).
	 * @param entry - The inherited value and the config that defined it.
	 */
	function report(property: AST.JSONProperty, name: string, entry: InheritedEntry): void {
		context.report({
			data: {
				option: name,
				source: path.relative(path.dirname(filename), entry.source) || entry.source,
			},
			fix: buildFix(property),
			loc: property.key.loc,
			messageId: MESSAGE_ID,
		});
	}

	function buildFix(property: AST.JSONProperty): TSESLint.ReportFixFunction | undefined {
		const node = property as unknown as TSESTree.Node;
		const before = sourceCode.getTokenBefore(node);
		const after = sourceCode.getTokenAfter(node);

		// A comment attached to (or trailing) the property would be stranded by
		// removal; report only.
		const leading = sourceCode.getCommentsBefore(node);
		const between = sourceCode.getCommentsAfter(node);
		const trailing =
			after?.value === ","
				? sourceCode
						.getCommentsAfter(after)
						.filter((comment) => comment.loc.start.line === after.loc.end.line)
				: [];
		if (leading.length > 0 || between.length > 0 || trailing.length > 0) {
			return undefined;
		}

		let start: number;
		let end: number;
		if (after?.value === ",") {
			// Not last: drop the leading whitespace, the property, and its comma.
			start = before?.range[1] ?? property.range[0];
			end = after.range[1];
		} else if (before?.value === ",") {
			// Last of several: drop the preceding comma back to the property's
			// end.
			start = before.range[0];
			end = property.range[1];
		} else {
			// Only property: drop it from between the braces.
			start = before?.range[1] ?? property.range[0];
			end = property.range[1];
		}

		return (fixer): TSESLint.RuleFix => fixer.removeRange([start, end]);
	}

	function checkObject(
		object: AST.JSONObjectExpression,
		lookup: (name: string) => InheritedEntry | undefined,
		isPathKey: (name: string) => boolean,
	): void {
		for (const property of object.properties) {
			const name = keyName(property);
			const entry = lookup(name);
			if (entry === undefined) {
				continue;
			}

			const childValue = getStaticJSONValue(property.value);
			if (isRedundant(name, childValue, entry.value, isPathKey(name))) {
				report(property, name, entry);
			}
		}
	}

	return {
		Program(): void {
			const statement = sourceCode.ast.body.at(0);
			if (statement?.expression.type !== "JSONObjectExpression") {
				return;
			}

			const root = statement.expression;
			const extendsProperty = findProperty(root, "extends");
			if (extendsProperty === undefined) {
				return;
			}

			const inherited = buildInheritedConfig(
				filename,
				getStaticJSONValue(extendsProperty.value),
			);
			if (inherited === undefined) {
				return;
			}

			const compilerOptions = findProperty(root, "compilerOptions");
			if (compilerOptions?.value.type === "JSONObjectExpression") {
				checkObject(
					compilerOptions.value,
					(name) => {
						return inherited.compilerOptions.get(name);
					},
					(name) => {
						return PATH_KEYS.has(name);
					},
				);
			}

			// Top-level include/exclude/files replace rather than merge, and are
			// always path/glob-valued.
			checkObject(
				root,
				(name) => {
					return inherited.topLevel.get(name);
				},
				() => {
					return true;
				},
			);
		},
	};
}

export const noRedundantTsconfigOptions = createEslintRule<Options, MessageIds, JsonSourceCode>({
	name: RULE_NAME,
	create,
	defaultOptions: [],
	meta: {
		docs: {
			description:
				"Disallow tsconfig options that redundantly re-set a value already provided by an extended config",
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
