// Maps a change set to the rules whose benchmarks it can move, so CI only
// re-runs those. Run: node benchmark/affected-rules.mjs <base-ref>
//
// Prints one line: `*` (run everything), a comma-separated rule list, or
// nothing (no benchmarked code changed). config.ts reads the result from the
// BENCH_RULES env var. See ./README.md.

import { execFileSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const ALL = "*";

const ARROW_RULE_ID = "arrow-return-style";
const FLOATING_RULE_ID = "no-floating-point-equality";

// Files that never reach the built plugin or the benchmark harness.
const IGNORED = [
	/\.spec\.ts$/,
	/\.md$/,
	/(?:^|\/)\.gitkeep$/,
	/^src\/rules\/test\.ts$/,
	/^src\/oxlint[^/]*\.ts$/,
];

// Files outside a single rule that can shift every rule's timings: shared rule
// code, the plugin entry, the harness, its config/patch, and the build.
const GLOBAL = [
	/^src\//,
	/^benchmark\//,
	/^patches\//,
	/^\.github\/workflows\/benchmark\.yaml$/,
	/^package\.json$/,
	/^pnpm-lock\.yaml$/,
	/^pnpm-workspace\.yaml$/,
	/^tsconfig\.json$/,
	/^tsdown\.config\.ts$/,
];

/**
 * @param {Array<string>} files Changed paths, repo-relative, `/`-separated.
 * @returns {"*" | Array<string>} ALL, or the sorted affected rule IDs.
 */
export function affectedRules(files) {
	const rules = new Set();
	for (const file of files) {
		if (IGNORED.some((pattern) => pattern.test(file))) {
			continue;
		}

		const rule = /^src\/rules\/([^/]+)\//.exec(file)?.[1];
		if (rule !== undefined && rule !== "shared") {
			rules.add(rule);
			continue;
		}

		const coarse = /^benchmark\/cases\/all\/([^/]+)\.tsx$/.exec(file)?.[1];
		if (coarse !== undefined) {
			rules.add(coarse);
			continue;
		}

		if (/^benchmark\/cases\/floating-[^/]+\.ts$/.test(file)) {
			rules.add(FLOATING_RULE_ID);
			continue;
		}

		if (/^benchmark\/cases\/[^/]+\.ts$/.test(file)) {
			rules.add(ARROW_RULE_ID);
			continue;
		}

		if (GLOBAL.some((pattern) => pattern.test(file))) {
			return ALL;
		}
	}

	return [...rules].sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const base = process.argv[2];
	if (base === undefined) {
		console.error("usage: node benchmark/affected-rules.mjs <base-ref>");
		process.exit(2);
	}

	// --no-renames lists both sides of a move, so the old location counts too.
	const files = execFileSync("git", ["diff", "--name-only", "--no-renames", base, "HEAD"], {
		encoding: "utf8",
	})
		.split("\n")
		.filter((file) => file !== "");
	const affected = affectedRules(files);
	console.log(affected === ALL ? ALL : affected.join(","));
}
