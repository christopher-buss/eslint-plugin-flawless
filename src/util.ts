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
