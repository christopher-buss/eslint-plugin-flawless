import { defineConfig } from "tsdown";

export default defineConfig({
	clean: true,
	deps: {
		alwaysBundle: ["ts-api-utils"],
		neverBundle: [
			"@oxlint/plugins",
			"@typescript-eslint/utils",
			"jsonc-eslint-parser",
			"toml-eslint-parser",
			"typescript",
		],
	},
	entry: ["src/index.ts", "src/oxlint.ts", "src/rules/arrow-return-style/worker.ts"],
	fixedExtension: true,
	format: ["esm"],
	onSuccess() {
		console.info("🙏 Build succeeded!");
	},
	publint: true,
	shims: true,
	unused: {
		// oxlint is a peer because it loads `dist/oxlint.mjs` as a jsPlugin and
		// the plugin API it provides is version-sensitive. It is a CLI, so
		// nothing here ever imports it.
		ignore: { peerDependencies: ["oxlint"] },
		level: "error",
	},
});
