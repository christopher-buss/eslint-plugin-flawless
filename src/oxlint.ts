import type { Plugin, Rule } from "@oxlint/plugins";
import { definePlugin } from "@oxlint/plugins";

import { plugin, PLUGIN_NAME } from "./plugin";

/**
 * Oxlint `jsPlugins` entry point.
 *
 * Exposes only the dual-runtime rules — those authored with
 * `createFlawlessRule`, identified by the presence of a `createOnce`
 * method. Type-aware (`naming-convention`) and custom-parser (`toml-sort-keys`,
 * `yaml-block-key-blank-lines`) rules are intentionally excluded: oxlint's JS
 * plugin API supports neither TypeScript type information nor foreign parsers.
 *
 * The rule objects are shared verbatim with the ESLint plugin
 * (`./plugin`); oxlint runs their `createOnce` method while ESLint runs the
 * delegating `create`. `meta.name` stays `flawless`, so config keys match the
 * ESLint prefix (e.g. `flawless/purity`).
 */
const rules: Record<string, Rule> = {};
for (const [name, rule] of Object.entries(plugin.rules)) {
	if ("createOnce" in rule) {
		rules[name] = rule as unknown as Rule;
	}
}

export default definePlugin({
	meta: { name: PLUGIN_NAME },
	rules,
} satisfies Plugin);
