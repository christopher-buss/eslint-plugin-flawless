import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";

const directory = fileURLToPath(new URL(".", import.meta.url));
const packageEntry = import.meta.resolve("eslint-rule-benchmark");
const { runBenchmarksFromConfig } = await import(
	new URL("../runners/run-benchmarks-from-config.js", packageEntry).href
);
const { runBenchmark } = await import(new URL("./benchmark/run-benchmark.js", packageEntry).href);

describe("typed benchmark harness", () => {
	it("reports typed detection and autofix timings with short sample names", async () => {
		const reportDirectory = mkdtempSync(path.join(tmpdir(), "flawless-typed-benchmark-"));
		const outputPath = path.join(reportDirectory, "report.json");
		const exitCode = process.exitCode;
		vi.stubEnv("GITHUB_EVENT_NAME", "");
		vi.stubEnv("CI", "true");
		try {
			await runBenchmarksFromConfig({
				configDirectory: directory,
				eslintConfigFile: path.join(directory, "eslint.config.mjs"),
				reporterOptions: [{ format: "json", outputPath }],
				userConfig: {
					iterations: 1,
					timeout: 1,
					warmup: { enabled: false, iterations: 0 },
					tests: [false, true].map((fix) => ({
						cases: [{ testPath: "./cases/typed/annotation-removals.ts" }],
						fix,
						name: fix ? "typed autofix" : "typed detection",
						ruleId: "no-redundant-type-annotation",
						rulePath: "../dist/index.mjs",
					})),
				},
			});
			expect(process.exitCode).toBe(exitCode);
			const report = JSON.parse(readFileSync(outputPath, "utf8"));
			expect(report.testSpecifications.map(({ name }) => name)).toStrictEqual([
				"typed detection",
				"typed autofix",
			]);
			for (const spec of report.testSpecifications) {
				const sample = spec.testCases[0].samples[0];
				expect(sample.sampleName).toBe("annotation-removals.ts");
				expect(sample.metrics.totalSamples).toBeGreaterThan(0);
			}
		} finally {
			process.exitCode = exitCode;
			vi.unstubAllEnvs();
			rmSync(reportDirectory, { recursive: true, force: true });
		}
	}, 30_000);

	it("fails rather than silently skipping a fixture missing from its typed project", async () => {
		const exitCode = process.exitCode;
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const results = await runBenchmark({
				configDirectory: directory,
				eslintConfigFile: path.join(directory, "eslint.config.mjs"),
				config: { iterations: 1, timeout: 1, warmup: { enabled: false, iterations: 0 } },
				testCases: [
					{
						id: "missing-project-file",
						name: "missing project file",
						rule: {
							fix: false,
							path: "../dist/index.mjs",
							ruleId: "no-redundant-type-annotation",
							severity: 2,
						},
						samples: [
							{
								code: "const value: number = 1;",
								filePath: path.join(directory, "cases/typed/missing.ts"),
								filename: "missing.ts",
								language: "typescript",
							},
						],
					},
				],
			});
			expect(results).toBeNull();
			expect(process.exitCode).toBe(1);
			expect(errors).toHaveBeenCalled();
		} finally {
			process.exitCode = exitCode;
			errors.mockRestore();
		}
	}, 30_000);
});
