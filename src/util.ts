import type { TSESLint } from "@typescript-eslint/utils";
import { RuleCreator } from "@typescript-eslint/utils/eslint-utils";

import { repository, version } from "../package.json";

export interface PluginDocumentation {
	description: string;
	recommended?: boolean;
	requiresTypeChecking: boolean;
}

const createRule = RuleCreator<PluginDocumentation>((name) => {
	const repoUrl = repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
	return `${repoUrl}/blob/v${version}/src/rules/${name}/documentation.md`;
});

/**
 * A rule context whose `sourceCode` is replaced with a custom type. YAML rules
 * use this to receive a `YAMLSourceCode` (whose token/AST APIs accept YAML
 * nodes) instead of the default ESLint `SourceCode`.
 *
 * @template MessageIds - The rule's message identifiers.
 * @template Options - The rule's options tuple.
 * @template SourceCode - The source code type exposed on `context.sourceCode`.
 */
export type RuleContextWithSourceCode<
	MessageIds extends string,
	Options extends ReadonlyArray<unknown>,
	SourceCode,
> = Omit<Readonly<TSESLint.RuleContext<MessageIds, Options>>, "sourceCode"> & {
	readonly sourceCode: SourceCode;
};

/**
 * A rule listener extended with oxlint's `createOnce` per-file lifecycle hooks.
 *
 * `before` runs before AST traversal of each file (returning `false` skips the
 * file); `after` runs once traversal completes. Under oxlint these map to the
 * native hooks; under ESLint {@link createFlawlessRule} emulates them.
 */
export type FlawlessRuleListener = TSESLint.RuleListener & {
	after?: () => void;
	before?: () => boolean | void;
};

/**
 * The context passed to a {@link createFlawlessRule} `createOnce` function.
 *
 * Equivalent to a standard ESLint rule context; a distinct alias documents that
 * `sourceCode`/`options`/`report` are only safe to read inside `before` or a
 * visitor (never in the `createOnce` body).
 *
 * @template MessageIds - The rule's message identifiers.
 * @template Options - The rule's options tuple.
 */
export type FlawlessRuleContext<
	MessageIds extends string,
	Options extends ReadonlyArray<unknown>,
> = Readonly<TSESLint.RuleContext<MessageIds, Options>>;

/**
 * An ESLint rule module that additionally carries oxlint's `createOnce` method,
 * so a single definition runs on both linters.
 *
 * @template Options - The rule's options tuple.
 * @template MessageIds - The rule's message identifiers.
 * @template SourceCode - The source code type exposed on `context.sourceCode`.
 */
export type FlawlessRuleModule<
	Options extends ReadonlyArray<unknown>,
	MessageIds extends string,
	SourceCode = Readonly<TSESLint.SourceCode>,
> = ReturnType<typeof createRule<Options, MessageIds>> & {
	createOnce: (
		context: RuleContextWithSourceCode<MessageIds, Options, SourceCode>,
	) => FlawlessRuleListener;
};

type BaseRule<Options extends ReadonlyArray<unknown>, MessageIds extends string> = Parameters<
	typeof createRule<Options, MessageIds>
>[0];

/**
 * Creates a rule with a docs URL, allowing a rule's `create` to receive a
 * context with a custom `sourceCode` type (such as a YAML source code). The
 * `SourceCode` type parameter defaults to ESLint's `SourceCode`, so standard
 * rules are unaffected.
 *
 * @template Options - The rule's options tuple.
 * @template MessageIds - The rule's message identifiers.
 * @template SourceCode - The source code type exposed on `context.sourceCode`.
 * @param rule - The rule definition (meta, name, defaultOptions, create).
 * @returns The created rule module.
 */
export function createEslintRule<
	Options extends ReadonlyArray<unknown>,
	MessageIds extends string,
	SourceCode = Readonly<TSESLint.SourceCode>,
>(
	rule: Omit<BaseRule<Options, MessageIds>, "create"> & {
		create: (
			context: RuleContextWithSourceCode<MessageIds, Options, SourceCode>,
			optionsWithDefault: Readonly<Options>,
		) => TSESLint.RuleListener;
	},
): ReturnType<typeof createRule<Options, MessageIds>> {
	return createRule(rule as BaseRule<Options, MessageIds>);
}

/**
 * Creates a dual-runtime rule from oxlint's `createOnce` alternative API.
 *
 * The rule is authored once against `createOnce` (oxlint's per-run entry point,
 * where per-file state is created in a `before` hook). The returned module
 * also exposes an ESLint-compatible `create` that delegates to `createOnce` on
 * each file, so the same object works with ESLint's `RuleTester` and the oxlint
 * `jsPlugins` loader alike. Oxlint ignores `create` when `createOnce` is
 * present; ESLint ignores `createOnce`.
 *
 * Rule bodies keep `@typescript-eslint` node/context types at the boundary
 * (oxlint's AST is structurally ESTree at runtime); `@eslint-react/core` helpers
 * are typed against those contexts, so a full switch to oxlint's `ESTree` types
 * is intentionally avoided.
 *
 * IMPORTANT: `context.sourceCode`, `context.options`, and `context.report` must
 * not be read in the `createOnce` body — only inside `before` or a visitor. In
 * oxlint's runtime they throw at setup time.
 *
 * @template Options - The rule's options tuple.
 * @template MessageIds - The rule's message identifiers.
 * @template SourceCode - The source code type exposed on `context.sourceCode`.
 * @param rule - The rule definition (meta, name, defaultOptions, createOnce).
 * @returns A rule module usable by both ESLint and oxlint.
 */
export function createFlawlessRule<
	Options extends ReadonlyArray<unknown>,
	MessageIds extends string,
	SourceCode = Readonly<TSESLint.SourceCode>,
>({
	createOnce,
	...meta
}: Omit<BaseRule<Options, MessageIds>, "create"> & {
	createOnce: (
		context: RuleContextWithSourceCode<MessageIds, Options, SourceCode>,
	) => FlawlessRuleListener;
}): FlawlessRuleModule<Options, MessageIds, SourceCode> {
	function create(
		context: Readonly<TSESLint.RuleContext<MessageIds, Options>>,
	): TSESLint.RuleListener {
		const { after, before, ...visitors } = createOnce(
			context as RuleContextWithSourceCode<MessageIds, Options, SourceCode>,
		);
		if (before !== undefined && before() === false) {
			return {};
		}

		if (after === undefined) {
			return visitors;
		}

		// ESLint has no per-file `after` hook; run it at the end of traversal.
		const existing = visitors["Program:exit"];
		visitors["Program:exit"] = (node): void => {
			existing?.(node);
			after();
		};

		return visitors;
	}

	const module = createRule({ ...meta, create });

	return Object.assign(module, { createOnce });
}
