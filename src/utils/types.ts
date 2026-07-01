import type { TOMLSourceCode } from "eslint-plugin-toml";
import type { YAMLSourceCode } from "eslint-plugin-yml";

import type { RuleContextWithSourceCode } from "../util";

export type TomlContext<
	MessageIds extends string,
	Options extends ReadonlyArray<unknown>,
> = RuleContextWithSourceCode<MessageIds, Options, TOMLSourceCode>;

export type YamlContext<
	MessageIds extends string,
	Options extends ReadonlyArray<unknown>,
> = RuleContextWithSourceCode<MessageIds, Options, YAMLSourceCode>;
