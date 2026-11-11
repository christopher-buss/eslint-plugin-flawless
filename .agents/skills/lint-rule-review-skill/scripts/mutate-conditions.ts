// Mutates conditions in one rule file, runs its tests after each change, and lists mutants that survive.
// A survivor means no test noticed the change: either a test is missing or the code is dead.
// Run from the target repo root, or the package folder its tests run from, so its own `typescript` package is used.
// Needs Node 22.18 or newer.
//
//   node mutate-conditions.ts --file src/rules/foo.ts --test "pnpm vitest run foo"
//     Limit to changed lines with one of: --base origin/main | --diff pr.diff | --lines 10-40,55
//     Other options: [--max 60] [--timeout 180] [--out results.json] [--typescript <path to a typescript 5 or 6 package>]
//
// This edits the rule file in place, so don't run anything else against the rule until it finishes.
// The original stays in a backup during a run, which also locks the file against a second run.
// Survivors marked likelyTypeOnly are bare null-check early exits, which often exist only for the compiler.
import type * as TS from "typescript";

import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash } from "node:crypto";
import {
	accessSync,
	closeSync,
	constants as fileConstants,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { constants, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs as parseCommandLine } from "node:util";

export interface Mutant {
	end: number;
	from: string;
	kind: string;
	likelyTypeOnly: boolean;
	line: number;
	start: number;
	to: string;
}

type Args = ReturnType<typeof parseArgs>;

// Only a single check that exits when the value is missing, such as `a == null` or `!a`.
const nullCheck = /^[^&|]*[^!=]===? *(?:null|undefined)$|^!\w+$/;

const usage =
	'Usage: --file <rule> --test "<command>" [--base <ref> | --diff <file> | --lines 10-40,55] [--max 60] [--timeout 180] [--out <file>] [--typescript <path>]';

/**
 * Reads added line numbers for one file from a unified diff with any amount of context.
 */
export function addedLines(diff: string, file: string) {
	const byFile = linesByFile(diff);
	const exact = byFile.get(file);

	if (exact) {
		return exact;
	}

	const matching = [...byFile].filter(
		([target]) => file.endsWith(`/${target}`) || target.endsWith(`/${file}`),
	);

	return new Set(matching.flatMap(([, lines]) => [...lines]));
}

function linesByFile(diff: string) {
	const byFile = new Map<string, Set<number>>();
	let added = new Set<number>();
	let line = 0;
	let newLeft = 0;

	for (const text of diff.split("\n")) {
		if (newLeft > 0) {
			if (text.startsWith("+")) {
				added.add(line++);
				newLeft--;
			} else if (!text.startsWith("-") && !text.startsWith("\\")) {
				line++;
				newLeft--;
			}
		} else if (text.startsWith("+++ ")) {
			// Tabs start a timestamp, or end a path that has spaces. Carriage returns come from CRLF diffs.
			const target = unquotePath(
				text.slice(4).replace(/[\t\r].*$/, ""),
			).replace(/^b\//, "");

			added = byFile.get(target) ?? new Set();
			byFile.set(target, added);
		} else {
			const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(text);

			if (hunk) {
				const [, start, newCount = "1"] = hunk;

				line = Number(start);
				newLeft = Number(newCount);
			}
		}
	}

	return byFile;
}

/**
 * Finds where a run keeps a file's original contents.
 * That's outside the rule's folder, because plugins often load every file in it.
 * It's inside .git where possible, so that it outlives a reboot and doesn't depend on the session's temp folder.
 */
export function backupPath(file: string) {
	const resolved = realpathSync.native(file);
	const directory = path.dirname(resolved);
	const inGit = tryGit(
		"-C",
		directory,
		"rev-parse",
		"--git-path",
		"mutate-conditions",
	);
	const hash = createHash("sha256").update(resolved).digest("hex").slice(0, 16);

	return path.join(
		inGit
			? path.resolve(directory, inGit)
			: path.join(tmpdir(), "mutate-conditions"),
		`${hash}-${path.basename(resolved)}`,
	);
}

/**
 * Lists mutants for a source file, optionally limited to a set of line numbers.
 */
export function findMutants(
	ts: typeof TS,
	file: string,
	original: string,
	lines?: Set<number>,
) {
	const source = ts.createSourceFile(
		file,
		original,
		ts.ScriptTarget.Latest,
		true,
	);
	const mutants: Mutant[] = [];
	const seen = new Set<string>();
	const textOf = (node: TS.Node) =>
		original.slice(node.getStart(source), node.end);

	function isBareExit(statement: TS.Statement) {
		const inner =
			ts.isBlock(statement) && statement.statements.length === 1
				? statement.statements[0]
				: statement;

		return (
			ts.isContinueStatement(inner) ||
			(ts.isReturnStatement(inner) &&
				(!inner.expression || textOf(inner.expression) === "undefined"))
		);
	}

	const lineOf = (position: number) =>
		source.getLineAndCharacterOfPosition(position).line + 1;

	// `removed` is the part this mutant takes away, which is what has to overlap the selected lines.
	function add(
		node: TS.Node,
		replacement: string,
		kind: string,
		removed = node,
	) {
		const start = node.getStart(source);
		const line = lineOf(removed.getStart(source));
		const lastLine = lineOf(removed.end);
		const key = `${String(start)}:${String(node.end)}:${replacement}`;

		if (
			(lines &&
				![...lines].some(
					(selected) => selected >= line && selected <= lastLine,
				)) ||
			textOf(node) === replacement ||
			seen.has(key)
		) {
			return;
		}

		seen.add(key);

		const { parent } = node;

		mutants.push({
			end: node.end,
			from: textOf(node),
			kind,
			// Only removing the guard says that. Other mutants of it take the exit for real values.
			likelyTypeOnly:
				kind === "if-never" &&
				ts.isIfStatement(parent) &&
				nullCheck.test(textOf(node)) &&
				isBareExit(parent.thenStatement),
			line,
			start,
			to: replacement,
		});
	}

	// Skips arrays in `meta`, such as message text and schema enums, which tests rarely pin down.
	function isInMeta(node: TS.Node) {
		return !!ts.findAncestor(
			node,
			(ancestor) =>
				ts.isPropertyAssignment(ancestor) && textOf(ancestor.name) === "meta",
		);
	}

	function visit(node: TS.Node) {
		if (ts.isIfStatement(node)) {
			add(node.expression, "true", "if-always");
			add(node.expression, "false", "if-never");
		} else if (ts.isConditionalExpression(node)) {
			add(node.condition, "true", "ternary-always");
			add(node.condition, "false", "ternary-never");
		} else if (
			ts.isBinaryExpression(node) &&
			(node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
				node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
		) {
			add(node, textOf(node.left), "drop-right-operand", node.right);
			add(node, textOf(node.right), "drop-left-operand", node.left);
		} else if (
			ts.isPrefixUnaryExpression(node) &&
			node.operator === ts.SyntaxKind.ExclamationToken
		) {
			add(node, textOf(node.operand), "remove-negation");
		} else if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			["every", "some"].includes(node.expression.name.text)
		) {
			const { name } = node.expression;

			add(name, name.text === "some" ? "every" : "some", "swap-some-every");
		} else if (
			ts.isExpressionStatement(node) &&
			ts.isCallExpression(node.expression)
		) {
			add(node, ";", "delete-call-statement");
		} else if (ts.isCaseClause(node) && node.statements.length > 0) {
			add(node, "", "delete-case");
		} else if (
			ts.isArrayLiteralExpression(node) &&
			node.elements.length > 1 &&
			!isInMeta(node)
		) {
			for (const element of node.elements) {
				const others = node.elements
					.filter((other) => other !== element)
					.map(textOf);

				add(node, `[${others.join(", ")}]`, "drop-array-element", element);
			}
		}

		ts.forEachChild(node, visit);
	}

	visit(source);

	return mutants;
}

/**
 * Parses command line options, rejecting any this script doesn't know.
 */
export function parseArgs(argv: string[]) {
	const string = { type: "string" } as const;

	return parseCommandLine({
		args: argv,
		options: {
			base: string,
			diff: string,
			file: string,
			lines: string,
			max: string,
			out: string,
			test: string,
			timeout: string,
			typescript: string,
		},
	}).values;
}

/**
 * Expands a value like `10-12,55` into a set of line numbers.
 */
export function parseLines(value: string) {
	return new Set(
		value.split(",").flatMap((range) => {
			const match = /^(\d+)(?:-(\d+))?$/.exec(range);
			const start = Number(match?.[1]);
			const end = Number(match?.[2] ?? start);

			if (!match || end < start) {
				throw new Error(`Bad line range: ${range}`);
			}

			return Array.from({ length: end - start + 1 }, (_, i) => start + i);
		}),
	);
}

function changedLines(args: Args, file: string) {
	if (args.lines !== undefined) {
		return parseLines(args.lines);
	}

	if (args.diff !== undefined) {
		return addedLines(readFileSync(args.diff, "utf8"), repoPath(file));
	}

	if (args.base !== undefined) {
		// No pathspec, because git can't see a rename through one: the whole file would look new.
		const diff = execFileSync(
			"git",
			[
				"diff",
				"--dst-prefix=b/",
				"--find-renames",
				"--no-color",
				"--no-ext-diff",
				"--no-relative",
				"--src-prefix=a/",
				tryGit("merge-base", args.base, "HEAD") ?? args.base,
			],
			{ encoding: "utf8", maxBuffer: Infinity },
		);

		return linesByFile(diff).get(repoPath(file)) ?? new Set<number>();
	}

	return undefined;
}

// Paths in a diff start at the repo root, but --file starts wherever this is running.
function loadTypeScript(typescriptPath: string | undefined) {
	const require = createRequire(path.join(process.cwd(), "noop.js"));
	let ts: typeof TS;

	try {
		ts = require(
			typescriptPath ? path.resolve(typescriptPath) : "typescript",
		) as typeof TS;
	} catch {
		console.error(
			"Could not resolve `typescript`. Run from the repo root after installing dependencies, or pass --typescript.",
		);
		return undefined;
	}

	// TypeScript 7 has no createSourceFile. Parsing is all this script needs, so any older copy works.
	if (!("createSourceFile" in ts)) {
		console.error(`typescript ${(ts as typeof TS).version} has no createSourceFile API. Install an older copy outside the repo and pass it:
  npm install --prefix /tmp/mutate-ts typescript@6
  ... --typescript /tmp/mutate-ts/node_modules/typescript`);
		return undefined;
	}

	return ts;
}

async function main() {
	// A reader such as `head` going away shouldn't end the run.
	for (const stream of [process.stderr, process.stdout]) {
		stream.on("error", () => undefined);
	}

	let args: Args;

	try {
		args = parseArgs(process.argv.slice(2));
	} catch (error) {
		console.error(`${String(error)}\n${usage}`);
		return 2;
	}

	const { file, test } = args;
	const maxMutants = Number(args.max ?? 60);
	const timeoutSeconds = Number(args.timeout ?? 180);

	// Timers overflow past about 24 days.
	if (
		!file ||
		!test ||
		!(maxMutants > 0) ||
		!(timeoutSeconds > 0 && timeoutSeconds < 2_000_000)
	) {
		console.error(usage);
		return 2;
	}

	const ts = loadTypeScript(args.typescript);

	if (!ts) {
		return 2;
	}

	let backup = "";
	let lock: number;

	try {
		accessSync(file, fileConstants.W_OK);

		if (args.out) {
			closeSync(openSync(args.out, "a"));
		}

		backup = backupPath(file);
		mkdirSync(path.dirname(backup), { recursive: true });
		lock = openSync(backup, "wx");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			console.error(
				`${backup} already exists, so another run is using ${file}, or one was killed. If no run is going, compare them, undo any mutant left in the rule while keeping real edits, then delete the backup:\n  diff "${backup}" "${file}"\n  rm "${backup}"`,
			);
			return 1;
		}

		console.error(String(error));
		return 2;
	}

	let child: ChildProcess | undefined;

	// Test runners start their own workers, so kill the whole process group, not just the shell.
	const killTests = () => {
		if (!child?.pid) {
			return;
		}

		// Windows has no process groups, and killing the shell alone leaves its children running.
		if (process.platform === "win32") {
			// Once the shell exits, its PID can go to an unrelated process.
			if (child.exitCode !== null || child.signalCode !== null) {
				return;
			}

			try {
				execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
					stdio: "ignore",
					windowsHide: true,
				});
			} catch {
				child.kill("SIGKILL");
			}

			return;
		}

		try {
			process.kill(-child.pid, "SIGKILL");
		} catch {
			child.kill("SIGKILL");
		}
	};

	let toRestore: Buffer | undefined;

	// This covers crashes too, which would skip a `finally`.
	process.on("exit", () => {
		killTests();

		if (toRestore) {
			writeFileSync(file, toRestore);
		}

		rmSync(backup, { force: true });
	});

	for (const signal of [
		"SIGABRT",
		"SIGALRM",
		"SIGHUP",
		"SIGINT",
		"SIGQUIT",
		"SIGTERM",
		"SIGUSR2",
	] as const) {
		process.on(signal, () => {
			// eslint-disable-next-line n/no-process-exit -- the signal would otherwise be swallowed
			process.exit(128 + constants.signals[signal]);
		});
	}

	let bytes: Buffer;
	let lines: Set<number> | undefined;

	try {
		// Only read once holding the lock, because a run already going may have a mutant in the file.
		bytes = readFileSync(file);
		writeFileSync(lock, bytes);
		closeSync(lock);
		lines = changedLines(args, file);
	} catch (error) {
		console.error(String(error));
		return 2;
	}

	if (lines?.size === 0) {
		console.error(
			`--base, --diff, or --lines selected nothing in ${file}. Check the path and the selection.`,
		);
		return 2;
	}

	const original = bytes.toString();
	const mutants = findMutants(ts, file, original, lines);

	if (mutants.length === 0) {
		writeReport(args.out, {
			file,
			found: 0,
			skipped: 0,
			survivors: [],
			tested: 0,
			timeouts: 0,
		});
		console.error(`No mutants found in ${file}, so nothing was tested.`);
		return 0;
	}

	const mutate = (text: string) => {
		toRestore = bytes;
		writeFileSync(file, text);
	};

	// This has to stay asynchronous: signal handlers can't run while the event loop is blocked.
	const runTests = () =>
		new Promise<"fail" | "pass" | "timeout">((resolve) => {
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				killTests();
			}, timeoutSeconds * 1000);

			child = spawn(test, {
				// On Windows, detached only opens a new console window, and taskkill finds the tree without it.
				detached: process.platform !== "win32",
				shell: true,
				stdio: "ignore",
				windowsHide: true,
			});
			// Without a listener, a failed spawn would crash the run.
			child.on("error", () => {
				resolve("fail");
			});
			child.on("close", (code) => {
				// Anything left in the background, such as a server, would keep serving the last mutant.
				killTests();
				child = undefined;
				clearTimeout(timer);

				if (timedOut) {
					resolve("timeout");
				} else {
					resolve(code === 0 ? "pass" : "fail");
				}
			});
		});

	const baseline = await runTests();

	if (baseline !== "pass") {
		console.error(
			baseline === "timeout"
				? `Tests took longer than ${String(timeoutSeconds)} seconds before any mutation. Raise --timeout.`
				: "Tests fail before any mutation, so results would mean nothing. Fix the test command first.",
		);
		return 1;
	}

	mutate(`${original}\nthrow new Error("mutate-conditions");\n`);

	if ((await runTests()) === "pass") {
		console.error(
			"Tests still pass with this file throwing as it loads, so the test command doesn't exercise it. Check the command and any test caching.",
		);
		return 1;
	}

	const selected = mutants.slice(0, maxMutants);
	const survivors: Mutant[] = [];
	let timeouts = 0;

	for (const [i, mutant] of selected.entries()) {
		mutate(
			original.slice(0, mutant.start) + mutant.to + original.slice(mutant.end),
		);

		const outcome = await runTests();

		if (outcome === "pass") {
			survivors.push(mutant);
		} else if (outcome === "timeout") {
			timeouts++;
		}

		console.error(
			`[${String(i + 1)}/${String(selected.length)}] ${outcome === "pass" ? "SURVIVED" : outcome} ${file}:${String(mutant.line)} ${mutant.kind}`,
		);
	}

	writeReport(args.out, {
		file,
		found: mutants.length,
		skipped: mutants.length - selected.length,
		survivors: survivors.map(({ from, kind, likelyTypeOnly, line, to }) => ({
			from: from.slice(0, 200),
			kind,
			likelyTypeOnly,
			line,
			to: to.slice(0, 200),
		})),
		tested: selected.length,
		timeouts,
	});

	// Last, so that this short list survives being piped through tail.
	console.error(
		`\n${String(survivors.length)} of ${String(selected.length)} mutants survived (${String(mutants.length - selected.length)} not tested, ${String(timeouts)} timed out):`,
	);

	for (const { kind, likelyTypeOnly, line } of survivors) {
		console.error(
			`  ${file}:${String(line)} ${kind}${likelyTypeOnly ? " (likely type-only)" : ""}`,
		);
	}

	return 0;
}

function repoPath(file: string) {
	return path.relative(
		tryGit("rev-parse", "--show-toplevel") ?? process.cwd(),
		realpathSync.native(file),
	);
}

// Git quotes paths with unusual characters, and writes non-ASCII bytes as octal.
function tryGit(...args: string[]) {
	try {
		return execFileSync("git", args, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return undefined;
	}
}

function unquotePath(text: string) {
	if (!text.startsWith('"')) {
		return text;
	}

	const bytes = text
		.slice(1, -1)
		.replace(/\\([0-7]{3}|.)/g, (_, code: string) =>
			code.length === 3 ? String.fromCharCode(parseInt(code, 8)) : code,
		);

	return Buffer.from(bytes, "latin1").toString();
}

function writeReport(out: string | undefined, report: object) {
	const text = JSON.stringify(report, null, "\t");

	if (out) {
		writeFileSync(out, text);
	} else {
		console.log(text);
	}
}

// import.meta.url has symlinks resolved, and skills are often installed through one.
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
	process.exitCode = await main();
}
