import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const filePath = fileURLToPath(import.meta.url);
const directoryName = dirname(filePath);

const ruleName = process.argv[2];

if (ruleName === undefined) {
	console.error("Please provide a rule name (e.g., my-new-rule).");
	process.exit(1);
}

if (!/^[a-z]+(?:-[a-z]+)*$/.test(ruleName)) {
	console.error("Rule name must be in kebab-case (e.g., my-new-rule).");
	process.exit(1);
}

const ruleNameCamelCase = ruleName.replace(
	/-([a-z])/g,
	(name) => name[1]?.toUpperCase() ?? "ERROR",
);
const ruleDescription = ruleName
	.split("-")
	.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
	.join(" ");

const rootDirectory = resolve(directoryName, "..");
const rulesDirectory = join(rootDirectory, "src", "rules");
const templateDirectory = join(rootDirectory, "scripts", "template");
const ruleDirectoryPath = join(rulesDirectory, ruleName);
const pluginPath = join(rootDirectory, "src", "plugin.ts");

// --- Create Rule Directory ---
if (existsSync(ruleDirectoryPath)) {
	console.error(`Rule directory already exists: ${ruleDirectoryPath}`);
	process.exit(1);
}

mkdirSync(ruleDirectoryPath);
console.log(`Created directory: ${ruleDirectoryPath}`);

// --- Copy and Process Template Files ---
const templateFiles = ["rule.ts.template", "rule.spec.ts.template", "documentation.md"];

for (const templateFileName of templateFiles) {
	const templateFilePath = join(templateDirectory, templateFileName);
	// Remove .template extension for the final file name
	const resolvedFileName = templateFileName.replace(/\.template$/, "");
	const resolvedFilePath = join(ruleDirectoryPath, resolvedFileName);

	let content = readFileSync(templateFilePath, "utf-8");
	content = content.replace(/\{\{RULE_NAME\}\}/g, ruleName);
	content = content.replace(/\{\{RULE_NAME_CAMEL_CASE\}\}/g, ruleNameCamelCase);
	content = content.replace(/\{\{RULE_DESCRIPTION\}\}/g, ruleDescription);

	writeFileSync(resolvedFilePath, content);
	console.log(`Created file: ${resolvedFilePath}`);
}

// --- Register the rule in src/plugin.ts ---
try {
	let pluginContent = readFileSync(pluginPath, "utf-8");

	// Insert the import alphabetically among the existing rule imports.
	const importStatement = `import { ${ruleNameCamelCase} } from "./rules/${ruleName}/rule";`;
	const ruleImportRegex = /^import \{ [^}]+ \} from "\.\/rules\/([^"]+)\/rule";$/gm;
	const ruleImports = [...pluginContent.matchAll(ruleImportRegex)];
	if (ruleImports.length === 0) {
		throw new Error("Could not find any existing rule imports.");
	}

	const importAfter = ruleImports.find((match) => (match[1] ?? "") > ruleName);
	const lastImport = ruleImports[ruleImports.length - 1];
	if (importAfter?.index !== undefined) {
		const before = pluginContent.slice(0, importAfter.index);
		const after = pluginContent.slice(importAfter.index);
		pluginContent = `${before}${importStatement}\n${after}`;
	} else if (lastImport?.index !== undefined) {
		const insertAt = lastImport.index + lastImport[0].length;
		const before = pluginContent.slice(0, insertAt);
		const after = pluginContent.slice(insertAt);
		pluginContent = `${before}\n${importStatement}${after}`;
	}

	// Rebuild the `rules` object with the new entry, kept alphabetical.
	const rulesObjectRegex = /rules: {\s*([\s\S]*?)\s*},/m;
	const rulesMatch = pluginContent.match(rulesObjectRegex);
	const existingRules = rulesMatch?.[1];
	if (rulesMatch === null || existingRules === undefined) {
		throw new Error("Could not find the 'rules' object.");
	}

	const entries = new Map<string, string>();
	for (const [, name, identifier] of existingRules.matchAll(/"([^"]+)": (\w+),/g)) {
		if (name !== undefined && identifier !== undefined) {
			entries.set(name, identifier);
		}
	}

	entries.set(ruleName, ruleNameCamelCase);
	const rebuilt = [...entries.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, identifier]) => `\t\t"${name}": ${identifier},`)
		.join("\n");
	pluginContent = pluginContent.replace(rulesMatch[0], `rules: {\n${rebuilt}\n\t},`);

	writeFileSync(pluginPath, pluginContent);
	console.log(`Updated: ${pluginPath}`);
} catch (err) {
	console.error(`Error updating ${pluginPath}:`, err);
	console.error(`Please add the following manually to ${pluginPath}:`);
	console.error(`  Import: import { ${ruleNameCamelCase} } from "./rules/${ruleName}/rule";`);
	console.error(`  Rule entry: "${ruleName}": ${ruleNameCamelCase},`);
}

console.log(`\nSuccessfully created rule "${ruleName}".`);
console.log("Next steps:");
console.log("1. Implement the rule logic in", join(ruleDirectoryPath, "rule.ts"));
console.log("2. Write tests in", join(ruleDirectoryPath, "rule.spec.ts"));
console.log("3. Update the documentation in", join(ruleDirectoryPath, "documentation.md"));
console.log("4. Run `pnpm lint --fix` to tidy the generated files.");
console.log(
	"5. Run `pnpm build` then `pnpm eslint-docs` to update the README (docs read from dist).",
);
console.log(
	"6. Consider adding the rule to the recommended config in src/configs/index.ts if applicable.",
);
