import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";
import path from "node:path";

import { runJsonc } from "../test";
import { noRedundantTsconfigOptions, RULE_NAME } from "./rule";

const messageId = "redundant";

const fixtures = path.join(__dirname, "fixtures");
// The child content comes from each case's `code`; only its `filename` must sit
// in the fixtures tree so relative and package `extends` resolve from disk.
const filename = path.join(fixtures, "tsconfig.json");

const valid: Array<ValidTestCase> = [
	// No `extends`: nothing to compare against.
	{
		filename,
		code: unindent`
			{
				"compilerOptions": { "strict": true }
			}
		`,
	},
	// Unresolvable parent: rule bails rather than guessing.
	{
		filename,
		code: unindent`
			{
				"extends": "./does-not-exist.json",
				"compilerOptions": { "strict": true }
			}
		`,
	},
	// Different value is a legitimate override.
	{
		filename,
		code: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { "strict": false }
			}
		`,
	},
	// A subset array differs structurally from the inherited array.
	{
		filename,
		code: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { "lib": ["esnext"] }
			}
		`,
	},
	// `null` clears an inherited value; it is not equal to that value.
	{
		filename,
		code: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { "downlevelIteration": null }
			}
		`,
	},
	// A plain-relative path repeats the text but resolves against the child's
	// own directory, so it is not redundant.
	{
		filename,
		code: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { "rootDir": "./src" }
			}
		`,
	},
	// Same for a plain-relative top-level glob.
	{
		filename,
		code: unindent`
			{
				"extends": "./base.json",
				"exclude": ["node_modules"]
			}
		`,
	},
	// Diamond extends: both branches share a grandparent, and the later branch
	// (b.json) inherits the grandparent's `strict: false`, so it wins over
	// a.json's `strict: true`. The child's `strict: true` is a genuine override.
	{
		filename,
		code: unindent`
			{
				"extends": ["./diamond/a.json", "./diamond/b.json"],
				"compilerOptions": { "strict": true }
			}
		`,
	},
];

const invalid: Array<InvalidTestCase> = [
	// A re-set boolean already provided by the parent.
	{
		filename,
		code: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": {
					"strict": true,
					"noEmit": true
				}
			}
		`,
		output: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": {
					"noEmit": true
				}
			}
		`,
		errors: [{ messageId }],
	},
	// A redundant last property drops its preceding comma.
	{
		filename,
		code: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": {
					"noEmit": true,
					"strict": true
				}
			}
		`,
		output: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": {
					"noEmit": true
				}
			}
		`,
		errors: [{ messageId }],
	},
	// Enum values fold case, matching TypeScript.
	{
		filename,
		code: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { "target": "ESNext" }
			}
		`,
		output: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { }
			}
		`,
		errors: [{ messageId }],
	},
	// An identical array is redundant.
	{
		filename,
		code: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { "lib": ["esnext", "dom"] }
			}
		`,
		output: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { }
			}
		`,
		errors: [{ messageId }],
	},
	// `lib` is an unordered set, so a reordered but identical array is redundant.
	{
		filename,
		code: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { "lib": ["dom", "esnext"] }
			}
		`,
		output: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { }
			}
		`,
		errors: [{ messageId }],
	},
	// Diamond extends where the child re-sets the value the later branch actually
	// resolves to (`strict: false`, inherited by b.json from the grandparent).
	{
		filename,
		code: unindent`
			{
				"extends": ["./diamond/a.json", "./diamond/b.json"],
				"compilerOptions": { "strict": false }
			}
		`,
		output: unindent`
			{
				"extends": ["./diamond/a.json", "./diamond/b.json"],
				"compilerOptions": { }
			}
		`,
		errors: [{ messageId }],
	},
	// A `${configDir}`-anchored path resolves to the same files, so it is
	// redundant.
	{
		filename,
		code: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { "outDir": "\${configDir}/dist" }
			}
		`,
		output: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { }
			}
		`,
		errors: [{ messageId }],
	},
	// Top-level `include` re-declared identically with a `${configDir}` anchor.
	{
		filename,
		code: unindent`
			{
				"extends": "./base.json",
				"include": ["\${configDir}/src"]
			}
		`,
		output: unindent`
			{
				"extends": "./base.json"
			}
		`,
		errors: [{ messageId }],
	},
	// A value defined two levels up the chain is still caught.
	{
		filename,
		code: unindent`
			{
				"extends": "./chain/mid.json",
				"compilerOptions": { "composite": true }
			}
		`,
		output: unindent`
			{
				"extends": "./chain/mid.json",
				"compilerOptions": { }
			}
		`,
		errors: [{ messageId }],
	},
	// Package `extends` resolved through the real `@isentinel/tsconfig` exports
	// map.
	{
		filename,
		code: unindent`
			{
				"extends": "@isentinel/tsconfig/typescript",
				"compilerOptions": { "skipLibCheck": true }
			}
		`,
		output: unindent`
			{
				"extends": "@isentinel/tsconfig/typescript",
				"compilerOptions": { }
			}
		`,
		errors: [{ messageId }],
	},
	// Two redundant options (with a kept option between) are both removed.
	{
		filename,
		code: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": {
					"strict": true,
					"noEmit": true,
					"composite": true
				}
			}
		`,
		output: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": {
					"noEmit": true
				}
			}
		`,
		errors: [{ messageId }, { messageId }],
	},
	// A comment on the property would be stranded by removal: report, no fix.
	{
		filename,
		code: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": {
					// keep strict on
					"strict": true
				}
			}
		`,
		output: null,
		errors: [{ messageId }],
	},
];

runJsonc({
	name: RULE_NAME,
	invalid,
	rule: noRedundantTsconfigOptions,
	valid,
});
