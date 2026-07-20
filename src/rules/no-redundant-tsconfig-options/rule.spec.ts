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
		code: unindent`
			{
				"compilerOptions": { "strict": true }
			}
		`,
		filename,
	},
	// Unresolvable parent: rule bails rather than guessing.
	{
		code: unindent`
			{
				"extends": "./does-not-exist.json",
				"compilerOptions": { "strict": true }
			}
		`,
		filename,
	},
	// Different value is a legitimate override.
	{
		code: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { "strict": false }
			}
		`,
		filename,
	},
	// A subset array differs structurally from the inherited array.
	{
		code: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { "lib": ["esnext"] }
			}
		`,
		filename,
	},
	// `null` clears an inherited value; it is not equal to that value.
	{
		code: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { "downlevelIteration": null }
			}
		`,
		filename,
	},
	// A plain-relative path repeats the text but resolves against the child's
	// own directory, so it is not redundant.
	{
		code: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { "rootDir": "./src" }
			}
		`,
		filename,
	},
	// Same for a plain-relative top-level glob.
	{
		code: unindent`
			{
				"extends": "./base.json",
				"exclude": ["node_modules"]
			}
		`,
		filename,
	},
	// Diamond extends: both branches share a grandparent, and the later branch
	// (b.json) inherits the grandparent's `strict: false`, so it wins over
	// a.json's `strict: true`. The child's `strict: true` is a genuine override.
	{
		code: unindent`
			{
				"extends": ["./diamond/a.json", "./diamond/b.json"],
				"compilerOptions": { "strict": true }
			}
		`,
		filename,
	},
];

const invalid: Array<InvalidTestCase> = [
	// A re-set boolean already provided by the parent.
	{
		code: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": {
					"strict": true,
					"noEmit": true
				}
			}
		`,
		errors: [{ messageId }],
		filename,
		output: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": {
					"noEmit": true
				}
			}
		`,
	},
	// A redundant last property drops its preceding comma.
	{
		code: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": {
					"noEmit": true,
					"strict": true
				}
			}
		`,
		errors: [{ messageId }],
		filename,
		output: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": {
					"noEmit": true
				}
			}
		`,
	},
	// Enum values fold case, matching TypeScript.
	{
		code: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { "target": "ESNext" }
			}
		`,
		errors: [{ messageId }],
		filename,
		output: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { }
			}
		`,
	},
	// An identical array is redundant.
	{
		code: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { "lib": ["esnext", "dom"] }
			}
		`,
		errors: [{ messageId }],
		filename,
		output: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { }
			}
		`,
	},
	// `lib` is an unordered set, so a reordered but identical array is redundant.
	{
		code: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { "lib": ["dom", "esnext"] }
			}
		`,
		errors: [{ messageId }],
		filename,
		output: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { }
			}
		`,
	},
	// Diamond extends where the child re-sets the value the later branch actually
	// resolves to (`strict: false`, inherited by b.json from the grandparent).
	{
		code: unindent`
			{
				"extends": ["./diamond/a.json", "./diamond/b.json"],
				"compilerOptions": { "strict": false }
			}
		`,
		errors: [{ messageId }],
		filename,
		output: unindent`
			{
				"extends": ["./diamond/a.json", "./diamond/b.json"],
				"compilerOptions": { }
			}
		`,
	},
	// A `${configDir}`-anchored path resolves to the same files, so it is
	// redundant.
	{
		code: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { "outDir": "\${configDir}/dist" }
			}
		`,
		errors: [{ messageId }],
		filename,
		output: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": { }
			}
		`,
	},
	// Top-level `include` re-declared identically with a `${configDir}` anchor.
	{
		code: unindent`
			{
				"extends": "./base.json",
				"include": ["\${configDir}/src"]
			}
		`,
		errors: [{ messageId }],
		filename,
		output: unindent`
			{
				"extends": "./base.json"
			}
		`,
	},
	// A value defined two levels up the chain is still caught.
	{
		code: unindent`
			{
				"extends": "./chain/mid.json",
				"compilerOptions": { "composite": true }
			}
		`,
		errors: [{ messageId }],
		filename,
		output: unindent`
			{
				"extends": "./chain/mid.json",
				"compilerOptions": { }
			}
		`,
	},
	// Package `extends` resolved through the real `@isentinel/tsconfig` exports
	// map.
	{
		code: unindent`
			{
				"extends": "@isentinel/tsconfig/typescript",
				"compilerOptions": { "skipLibCheck": true }
			}
		`,
		errors: [{ messageId }],
		filename,
		output: unindent`
			{
				"extends": "@isentinel/tsconfig/typescript",
				"compilerOptions": { }
			}
		`,
	},
	// Two redundant options (with a kept option between) are both removed.
	{
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
		errors: [{ messageId }, { messageId }],
		filename,
		output: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": {
					"noEmit": true
				}
			}
		`,
	},
	// A comment on the property would be stranded by removal: report, no fix.
	{
		code: unindent`
			{
				"extends": "./base.json",
				"compilerOptions": {
					// keep strict on
					"strict": true
				}
			}
		`,
		errors: [{ messageId }],
		filename,
		output: null,
	},
];

runJsonc({
	name: RULE_NAME,
	invalid,
	rule: noRedundantTsconfigOptions,
	valid,
});
