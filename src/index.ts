import type { Linter } from "eslint";

import type { FlawlessConfigs } from "./configs";
import { configs } from "./configs";
import type { FlawlessPlugin } from "./plugin";
import { plugin } from "./plugin";

export type {
	TypeArgumentReference,
	TypeMatcher,
	TypeReference,
} from "./rules/naming-convention/utils";

const flawless: FlawlessPlugin & { configs: FlawlessConfigs } = {
	...plugin,
	configs,
};

export default flawless;

export type RuleOptions = {
	[K in keyof RuleDefinitions]: NonNullable<RuleDefinitions[K]["defaultOptions"]>;
};

export type Rules = {
	[K in keyof RuleOptions]: Linter.RuleEntry<RuleOptions[K]>;
};

type RuleDefinitions = typeof plugin.rules;
