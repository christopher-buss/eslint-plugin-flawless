import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		exclude: [...defaultExclude, "**/.claude/**"],
		globals: true,
		reporters: "dot",
		// The parser and speculative programs must share TypeScript's symbol
		// ID allocator. Loading a second Vite copy can collide with parser IDs.
		server: { deps: { external: ["typescript"] } },
	},
});
