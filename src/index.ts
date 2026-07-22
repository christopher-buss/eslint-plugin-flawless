import type { Linter } from "eslint";

import { configs } from "./configs";
import { plugin } from "./plugin";

export type { TypeMatcher, TypeReference } from "./rules/naming-convention/utils";

export default {
	...plugin,
	configs,
};

export type RuleOptions = {
	[K in keyof RuleDefinitions]: NonNullable<RuleDefinitions[K]["defaultOptions"]>;
};

export type Rules = {
	[K in keyof RuleOptions]: Linter.RuleEntry<RuleOptions[K]>;
};

type RuleDefinitions = typeof plugin.rules;
