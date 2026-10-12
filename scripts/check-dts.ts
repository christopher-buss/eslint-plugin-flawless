import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const declarations = ["dist/index.d.mts", "dist/oxlint.d.mts"];
const leaked = /import\("(?:\$\{configDir\}|node_modules\/)/g;

let failed = false;
for (const file of declarations) {
	const matches = readFileSync(path.join(root, file), "utf8").match(leaked) ?? [];
	if (matches.length > 0) {
		console.error(`${file}: ${matches.length} unresolvable import specifier(s)`);
		failed = true;
	}
}

try {
	const tsc = path.join(root, "node_modules/typescript/bin/tsc");
	execFileSync(process.execPath, [tsc, "-p", "dts-check/tsconfig.json"], {
		cwd: root,
		stdio: "inherit",
	});
} catch {
	console.error("consumer type check failed against the built declarations");
	failed = true;
}

if (failed) {
	process.exit(1);
}

console.log("declaration check passed");
