import type { JSONSchema, TSESLint } from "@typescript-eslint/utils";

import type { TOMLSourceCode } from "eslint-plugin-toml";
import type { AST } from "toml-eslint-parser";
import { getStaticTOMLValue } from "toml-eslint-parser";

import { createEslintRule } from "../../util";
import type { TomlContext } from "../../utils/types";

export const RULE_NAME = "toml-sort-keys";

const MESSAGE_ID = "unsorted";

export type MessageIds = typeof MESSAGE_ID;

export type Options = Array<SortSpec>;

interface SortOrderObject {
	caseSensitive?: boolean;
	natural?: boolean;
	type?: "asc" | "desc";
}

type SortOrder = Array<string> | SortOrderObject;

interface SortSpec {
	order: SortOrder;
	pathPattern: string;
}

/**
 * A sortable member of a table body: either a `key = value` pair or a
 * `[table]` / `[table.sub]` section header (which appears as a sibling of the
 * top-level table body in the flat TOML AST).
 */
type Entry = AST.TOMLKeyValue | AST.TOMLTable;

const messages = {
	[MESSAGE_ID]: "Expected {{target}} to follow the configured order.",
};

const schema: JSONSchema.JSONSchema4 = {
	items: {
		additionalProperties: false,
		properties: {
			order: {
				oneOf: [
					{ items: { type: "string" }, type: "array" },
					{
						additionalProperties: false,
						properties: {
							caseSensitive: { type: "boolean" },
							natural: { type: "boolean" },
							type: { enum: ["asc", "desc"], type: "string" },
						},
						type: "object",
					},
				],
			},
			pathPattern: { type: "string" },
		},
		required: ["order", "pathPattern"],
		type: "object",
	},
	type: "array",
};

function isTable(entry: Entry): entry is AST.TOMLTable {
	return entry.type === "TOMLTable";
}

/**
 * The dotted name of an entry, e.g. `settings`, `settings.node`, `_.path`.
 *
 * @param entry - The table header or key-value entry.
 * @returns The dotted key path as a string.
 */
function nameOf(entry: Entry): string {
	return getStaticTOMLValue(entry.key).join(".");
}

/**
 * Builds a rank function from an explicit order list. An entry matches an order
 * item when it equals it or is a dotted child of it (`settings.node` matches
 * `settings`), which keeps sub-tables grouped under their parent's slot.
 *
 * @param order - The configured names in their desired order.
 * @returns A function giving a name's rank, or `Infinity` when unlisted.
 */
function makeRank(order: ReadonlyArray<string>): (name: string) => number {
	return (name: string): number => {
		for (const [index, item] of order.entries()) {
			if (name === item || name.startsWith(`${item}.`)) {
				return index;
			}
		}

		return Number.POSITIVE_INFINITY;
	};
}

function makeFallback(config: SortOrderObject): (a: string, b: string) => number {
	const { caseSensitive = true, natural = false, type = "asc" } = config;
	const sensitivity = caseSensitive ? "variant" : "accent";
	return (a: string, b: string): number => {
		const result = a.localeCompare(b, "en", { numeric: natural, sensitivity });
		return type === "desc" ? -result : result;
	};
}

/**
 * Builds a comparator for one table body. Explicit-order entries sort first by
 * their listed position, then unlisted entries fall back to a natural/asc sort
 * (mirroring `yaml/sort-keys`). The fallback compares keys as written in
 * source, so quotes participate in the order and quoted keys (e.g.
 * `"github:owner/repo"`) group before bare keys. At the top level, bare
 * key-values are always kept before any `[table]` header, since TOML would
 * otherwise re-scope them.
 *
 * @param order - The order configuration for this table's path.
 * @param isTopLevel - Whether the body is the top-level table.
 * @param rawName - Returns an entry's key exactly as written in source.
 * @returns A comparator over two entries.
 */
function makeComparator(
	order: SortOrder,
	isTopLevel: boolean,
	rawName: (entry: Entry) => string,
): (a: Entry, b: Entry) => number {
	const rank = Array.isArray(order) ? makeRank(order) : undefined;
	const fallback = makeFallback(Array.isArray(order) ? { natural: true, type: "asc" } : order);
	return (a: Entry, b: Entry): number => {
		if (isTopLevel) {
			const aRank = isTable(a) ? 1 : 0;
			const bRank = isTable(b) ? 1 : 0;
			if (aRank !== bRank) {
				return aRank - bRank;
			}
		}

		if (rank !== undefined) {
			const aRank = rank(nameOf(a));
			const bRank = rank(nameOf(b));
			if (aRank !== bRank) {
				if (aRank === Number.POSITIVE_INFINITY) {
					return 1;
				}

				if (bRank === Number.POSITIVE_INFINITY) {
					return -1;
				}

				return aRank - bRank;
			}
		}

		return fallback(rawName(a), rawName(b));
	};
}

function create(context: TomlContext<MessageIds, Options>): TSESLint.RuleListener {
	const { options, sourceCode } = context;
	if (sourceCode.parserServices.isTOML !== true) {
		return {};
	}

	const specs = options.map(({ order, pathPattern }) => {
		return { order, pattern: new RegExp(pathPattern, "u") };
	});
	if (specs.length === 0) {
		return {};
	}

	function resolveOrder(path: string): SortOrder | undefined {
		for (const spec of specs) {
			if (spec.pattern.test(path)) {
				return spec.order;
			}
		}

		return undefined;
	}

	/**
	 * A comment counts as attached to an entry when it sits on its own line
	 * directly above it (no blank line, no trailing code). Such comments travel
	 * with the entry when it moves.
	 *
	 * @param comment - The comment to classify.
	 * @returns Whether the comment stands alone on its line.
	 */
	function isOwnLineComment(comment: AST.Comment): boolean {
		const before = sourceCode.getTokenBefore(comment, { includeComments: true });
		return before === null || before.loc.end.line < comment.loc.start.line;
	}

	function leadingStart(entry: Entry): number {
		const comments = sourceCode.getCommentsBefore(entry);
		let start = entry.range[0];
		let boundaryLine = entry.loc.start.line;
		for (let index = comments.length - 1; index >= 0; index -= 1) {
			const comment = comments[index];
			if (comment === undefined) {
				break;
			}

			if (comment.loc.end.line !== boundaryLine - 1 || !isOwnLineComment(comment)) {
				break;
			}

			start = comment.range[0];
			boundaryLine = comment.loc.start.line;
		}

		return start;
	}

	function trailingEnd(entry: Entry): number {
		const [comment] = sourceCode.getCommentsAfter(entry);
		if (comment?.loc.start.line === entry.loc.end.line) {
			return comment.range[1];
		}

		return entry.range[1];
	}

	function buildFix(
		entries: ReadonlyArray<Entry>,
		target: ReadonlyArray<Entry>,
	): TSESLint.ReportFixFunction | undefined {
		const text = sourceCode.getText();
		const blocks = entries.map((entry) => {
			return { end: trailingEnd(entry), entry, start: leadingStart(entry) };
		});

		// If a comment sits in the gap between two blocks it is unattributable
		// (not attached to either entry); moving blocks would strand it, so skip
		// the autofix and report only.
		for (let index = 1; index < blocks.length; index += 1) {
			const previous = blocks[index - 1];
			const current = blocks[index];
			if (previous === undefined || current === undefined) {
				return undefined;
			}

			if (/\S/u.test(text.slice(previous.end, current.start))) {
				return undefined;
			}
		}

		const first = blocks[0];
		const last = blocks[blocks.length - 1];
		if (first === undefined || last === undefined) {
			return undefined;
		}

		const textByEntry = new Map(
			blocks.map((block) => [block.entry, text.slice(block.start, block.end)]),
		);
		const parts: Array<string> = [];
		for (const [index, entry] of target.entries()) {
			const previous = target[index - 1];
			if (previous !== undefined) {
				parts.push(isTable(entry) || isTable(previous) ? "\n\n" : "\n");
			}

			parts.push(textByEntry.get(entry) ?? "");
		}

		const sortedText = parts.join("");
		return (fixer): TSESLint.RuleFix =>
			fixer.replaceTextRange([first.start, last.end], sortedText);
	}

	function verify(path: string, body: ReadonlyArray<Entry>, isTopLevel: boolean): void {
		if (body.length < 2) {
			return;
		}

		const order = resolveOrder(path);
		if (order === undefined) {
			return;
		}

		const entries = [...body];
		const target = [...entries].sort(
			makeComparator(order, isTopLevel, (entry) => sourceCode.getText(entry.key)),
		);

		let outOfPlace: Entry | undefined;
		for (const [index, entry] of entries.entries()) {
			if (entry !== target[index]) {
				outOfPlace = entry;
				break;
			}
		}

		if (outOfPlace === undefined) {
			return;
		}

		context.report({
			data: { target: path === "" ? "top-level tables" : `keys in "${path}"` },
			fix: buildFix(entries, target),
			loc: outOfPlace.key.loc,
			messageId: MESSAGE_ID,
		});
	}

	return {
		TOMLTable(node: AST.TOMLTable): void {
			verify(getStaticTOMLValue(node.key).join("."), node.body, false);
		},
		TOMLTopLevelTable(node: AST.TOMLTopLevelTable): void {
			verify("", node.body, true);
		},
	};
}

export const tomlSortKeys = createEslintRule<Options, MessageIds, TOMLSourceCode>({
	name: RULE_NAME,
	create,
	defaultOptions: [],
	meta: {
		defaultOptions: [],
		docs: {
			description: "Enforce a configured sort order for TOML keys and tables",
			recommended: false,
			requiresTypeChecking: false,
		},
		fixable: "code",
		hasSuggestions: false,
		messages,
		schema,
		type: "layout",
	},
});
