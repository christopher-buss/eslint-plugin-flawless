import type { Linter } from "eslint";

import type { FlawlessConfigs } from "./configs/index.ts";
import { configs } from "./configs/index.ts";
import type { FlawlessPlugin } from "./plugin.ts";
import { plugin } from "./plugin.ts";

export type {
	TypeArgumentReference,
	TypeMatcher,
	TypeReference,
} from "./rules/naming-convention/utils/index.ts";

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
