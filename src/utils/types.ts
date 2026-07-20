import type { TSESLint } from "@typescript-eslint/utils";

import type { TOMLSourceCode } from "eslint-plugin-toml";
import type { YAMLSourceCode } from "eslint-plugin-yml";
import type { AST } from "jsonc-eslint-parser";

import type { RuleContextWithSourceCode } from "../util";

/**
 * A `SourceCode` for configs parsed by `jsonc-eslint-parser`. That package ships
 * only AST types (no `SourceCode` type like `eslint-plugin-toml`), so the shape
 * is hand-defined: the JSON program AST and the parser's `isJSON` service.
 */
export type JsonSourceCode = Omit<Readonly<TSESLint.SourceCode>, "ast" | "parserServices"> & {
	readonly ast: AST.JSONProgram;
	readonly parserServices: { isJSON?: boolean };
};

export type JsonContext<
	MessageIds extends string,
	Options extends ReadonlyArray<unknown>,
> = RuleContextWithSourceCode<MessageIds, Options, JsonSourceCode>;

export type TomlContext<
	MessageIds extends string,
	Options extends ReadonlyArray<unknown>,
> = RuleContextWithSourceCode<MessageIds, Options, TOMLSourceCode>;

export type YamlContext<
	MessageIds extends string,
	Options extends ReadonlyArray<unknown>,
> = RuleContextWithSourceCode<MessageIds, Options, YAMLSourceCode>;
