import { defineConfig } from "tsdown";

export default defineConfig({
	clean: true,
	deps: {
		alwaysBundle: ["ts-api-utils"],
		neverBundle: ["@typescript-eslint/utils", "typescript"],
	},
	entry: ["src/index.ts"],
	fixedExtension: true,
	format: ["esm"],
	onSuccess() {
		console.info("🙏 Build succeeded!");
	},
	publint: true,
	shims: true,
	unused: {
		level: "error",
	},
});
