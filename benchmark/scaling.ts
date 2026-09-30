import { Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import builtPlugin from "../dist/index.mjs";
import { COARSE } from "./coarse";

// Growth check: catches rules whose cost grows super-linearly with file size.
// config.ts times each rule on one fixed-size fixture, so an O(n²) rule looks
// fine there — its fixture is small. Here each fixture is repeated SMALL and
// LARGE times (imports hoisted once, so it models one module growing) and only
// the rule's own time is measured (ESLint `stats`, parse excluded). A linear
// rule costs the same per copy at both sizes; a quadratic one costs
// LARGE/SMALL (64x) more per copy.
//
// Growth = (per-copy time at LARGE) / (per-copy time at SMALL). Linear rules
// land around 1–4 (GC and repeated top-level bindings add some drift); the
// O(n²) scans this was written to catch measured 20–25. A rule over
// MAX_GROWTH is re-measured once before failing, to absorb a noisy runner.
//
// Runs against the built plugin, like config.ts: `pnpm bench:scaling` builds
// first. BENCH_RULES narrows the run the same way it does for config.ts.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SMALL = 2;
const LARGE = 128;
const MAX_GROWTH = 8;
// Below this total rule time at LARGE, timer resolution dominates the ratio.
const MIN_LARGE_MS = 1;

const SUBJECTS = [
	...COARSE,
	{
		// The pure path: the oxfmt worker has its own detailed cases in config.ts.
		options: [{ useOxfmt: false }],
		ruleId: "arrow-return-style",
		testPath: "./cases/realistic.ts",
	},
	{ ruleId: "no-floating-point-equality", testPath: "./cases/floating-realistic.ts" },
];

const IMPORT_LINE = /^import\s/;

const median = (values: Array<number>): number => {
	const sorted = values.toSorted((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const linter = new Linter({ configType: "flat" });

function build(source: string, copies: number): string {
	const lines = source.split(/\r?\n/u);
	const imports = lines.filter((line) => IMPORT_LINE.test(line));
	const body = lines.filter((line) => !IMPORT_LINE.test(line)).join("\n");
	return [...imports, ...Array.from({ length: copies }, () => body)].join("\n");
}

/** Median rule-only time (ms) to lint `copies` repetitions of the fixture. */
function measure(subject: (typeof SUBJECTS)[number], copies: number): number {
	const absolutePath = path.resolve(HERE, subject.testPath);
	const extension = path.extname(absolutePath);
	const code = build(readFileSync(absolutePath, "utf8"), copies);
	const ruleKey = `flawless/${subject.ruleId}`;
	const config: Linter.Config = {
		files: ["**/*.ts", "**/*.tsx"],
		languageOptions: {
			parser: tsParser,
			parserOptions: { ecmaFeatures: { jsx: extension === ".tsx" } },
		},
		plugins: { flawless: builtPlugin },
		rules: { [ruleKey]: ["error", ...(subject.options ?? [])] },
	};

	const warmup = 2;
	const iterations = Math.max(4, Math.round(100 / copies));
	const times: Array<number> = [];
	for (let index = 0; index < warmup + iterations; index++) {
		const { messages } = linter.verifyAndFix(code, config, {
			filename: `scaling${extension}`,
			fix: false,
			stats: true,
		});
		const fatal = messages.find((message) => message.fatal === true);
		if (fatal !== undefined) {
			throw new Error(`${subject.ruleId} x${copies}: ${fatal.message}`);
		}

		if (index >= warmup) {
			times.push(linter.getTimes().passes[0]?.rules?.[ruleKey]?.total ?? 0);
		}
	}

	return median(times);
}

function growthOf(subject: (typeof SUBJECTS)[number]): { growth: number; large: number } {
	const small = measure(subject, SMALL);
	const large = measure(subject, LARGE);
	return { growth: large / LARGE / (small / SMALL), large };
}

const benchRules = process.env.BENCH_RULES;
const selected =
	benchRules === undefined || benchRules.trim() === "*"
		? undefined
		: new Set(
				benchRules
					.split(",")
					.map((ruleId) => ruleId.trim())
					.filter((ruleId) => ruleId !== ""),
			);
const subjects = SUBJECTS.filter(({ ruleId }) => selected === undefined || selected.has(ruleId));

if (subjects.length === 0) {
	console.log("No rules to check for growth.");
	process.exit(0);
}

console.log(`Rule-time growth per copy, x${SMALL} -> x${LARGE} (fail over ${MAX_GROWTH}):\n`);
const rows = subjects.map((subject) => {
	let { growth, large } = growthOf(subject);
	if (growth > MAX_GROWTH && large >= MIN_LARGE_MS) {
		({ growth, large } = growthOf(subject));
	}

	return { failed: growth > MAX_GROWTH && large >= MIN_LARGE_MS, growth, large, subject };
});

for (const { failed, growth, large, subject } of rows.toSorted((a, b) => b.growth - a.growth)) {
	console.log(
		`${failed ? "✖" : " "} ${subject.ruleId.padEnd(40)} ${growth.toFixed(2).padStart(6)}x  ` +
			`(${large.toFixed(1)} ms at x${LARGE})`,
	);
}

const failures = rows.filter(({ failed }) => failed);
if (failures.length > 0) {
	console.error(
		`\n✖ Super-linear rule time: ${failures.map(({ subject }) => subject.ruleId).join(", ")}.\n` +
			`  Look for a per-node scan of the whole file, scope, or text (see benchmark/README.md).\n`,
	);
	process.exitCode = 1;
}
