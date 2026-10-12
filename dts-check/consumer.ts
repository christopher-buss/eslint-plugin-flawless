// Imports the built plugin the way a consumer does, so `check:dts` catches
// declaration files that reference unresolvable modules.
import type { RuleOptions, Rules } from "eslint-plugin-flawless";
import flawless from "eslint-plugin-flawless";
import oxlintPlugin from "eslint-plugin-flawless/oxlint";

export const rules: Partial<Rules> = { purity: "error" };
export const options: RuleOptions["purity"] | undefined = undefined;
export const pluginName: string = flawless.meta.name;
export const recommended: object = flawless.configs.recommended;
export const oxlint: object = oxlintPlugin;
