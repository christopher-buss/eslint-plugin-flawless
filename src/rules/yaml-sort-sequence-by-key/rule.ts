import type { JSONSchema, TSESLint } from "@typescript-eslint/utils";

import type { YAMLSourceCode } from "eslint-plugin-yml";
import naturalCompare from "natural-compare";
import type { AST } from "yaml-eslint-parser";

import type { EslintRuleModule } from "../../util";
import { createEslintRule } from "../../util";
import type { YamlContext } from "../../utils/types";

export const RULE_NAME = "yaml-sort-sequence-by-key";

export type MessageIds = "shouldBeAfter" | "shouldBeBefore";

export type Options = Array<SortSpec>;

interface SortOrderObject {
	caseSensitive?: boolean;
	natural?: boolean;
	type?: "asc" | "desc";
}

interface SortSpec {
	key: string;
	order?: SortOrderObject;
	pathPattern: string;
}

type ResolvedOrder = Required<SortOrderObject>;

type Context = YamlContext<MessageIds, Options>;

type EntryNode = AST.YAMLContent | AST.YAMLWithMeta;

interface SortableEntry {
	aliases: Set<string>;
	anchors: Set<string>;
	node: EntryNode;
	value: number | string;
}

interface EntrySpan {
	end: number;
	item: SortableEntry;
	start: number;
}

const messages = {
	shouldBeAfter:
		"Expected sequence entries to be in {{orderText}} order by '{{key}}'. '{{thisValue}}' should be after '{{targetValue}}'.",
	shouldBeBefore:
		"Expected sequence entries to be in {{orderText}} order by '{{key}}'. '{{thisValue}}' should be before '{{targetValue}}'.",
};

const schema: JSONSchema.JSONSchema4 = {
	items: {
		additionalProperties: false,
		properties: {
			key: { type: "string" },
			order: {
				additionalProperties: false,
				properties: {
					caseSensitive: { type: "boolean" },
					natural: { type: "boolean" },
					type: { enum: ["asc", "desc"], type: "string" },
				},
				type: "object",
			},
			pathPattern: { type: "string" },
		},
		required: ["key", "pathPattern"],
		type: "object",
	},
	type: "array",
};

/**
 * Builds the pairwise order check, with the same semantics as the order object
 * of `yml/sort-sequence-values`: strings compare by code unit (or naturally),
 * numbers numerically, and values of mixed types are always in order.
 *
 * @param order - The configured order.
 * @returns Whether `a` may come before `b`.
 */
function makeIsValidOrder({
	caseSensitive,
	natural,
	type,
}: ResolvedOrder): (a: SortableEntry, b: SortableEntry) => boolean {
	return (a, b): boolean => {
		const [first, second] = type === "desc" ? [b.value, a.value] : [a.value, b.value];
		if (typeof first === "string" && typeof second === "string") {
			const left = caseSensitive ? first : first.toLowerCase();
			const right = caseSensitive ? second : second.toLowerCase();
			return natural ? naturalCompare(left, right) <= 0 : left <= right;
		}

		if (typeof first === "number" && typeof second === "number") {
			return first <= second;
		}

		return true;
	};
}

function orderText({ caseSensitive, natural, type }: ResolvedOrder): string {
	return `${natural ? "natural " : ""}${caseSensitive ? "" : "insensitive "}${type}ending`;
}

function unwrap(node: EntryNode | null): AST.YAMLContent | null {
	return node?.type === "YAMLWithMeta" ? node.value : node;
}

/**
 * Collects anchor and alias names used anywhere inside an entry.
 *
 * @param node - The entry (or a descendant).
 * @param item - The anchor and alias sets to fill.
 */
function collectAnchors(
	node: EntryNode | null,
	item: Pick<SortableEntry, "aliases" | "anchors">,
): void {
	if (node === null) {
		return;
	}

	switch (node.type) {
		case "YAMLAlias": {
			item.aliases.add(node.name);
			break;
		}
		case "YAMLMapping": {
			for (const pair of node.pairs) {
				collectAnchors(pair.key, item);
				collectAnchors(pair.value, item);
			}

			break;
		}
		case "YAMLScalar": {
			break;
		}
		case "YAMLSequence": {
			for (const entry of node.entries) {
				collectAnchors(entry, item);
			}

			break;
		}
		case "YAMLWithMeta": {
			if (node.anchor !== null) {
				item.anchors.add(node.anchor.name);
			}

			collectAnchors(node.value, item);
			break;
		}
	}
}

/**
 * Mirrors `yml/sort-sequence-values`: two entries keep their relative order
 * when one references an anchor the other defines.
 *
 * @param previous - The earlier entry.
 * @param next - The later entry.
 * @returns Whether the two entries must not swap.
 */
function shouldKeepOrder(previous: SortableEntry, next: SortableEntry): boolean {
	for (const alias of next.aliases) {
		if (previous.anchors.has(alias)) {
			return true;
		}
	}

	for (const anchor of next.anchors) {
		if (previous.aliases.has(anchor)) {
			return true;
		}
	}

	return false;
}

function bubbleSort(
	items: ReadonlyArray<SortableEntry>,
	isValidOrder: (a: SortableEntry, b: SortableEntry) => boolean,
): Array<SortableEntry> {
	const result = [...items];
	let swapped = true;
	while (swapped) {
		swapped = false;
		for (let index = 1; index < result.length; index += 1) {
			const previous = result[index - 1];
			const next = result[index];
			if (previous === undefined || next === undefined) {
				continue;
			}

			if (isValidOrder(previous, next) || shouldKeepOrder(previous, next)) {
				continue;
			}

			result[index - 1] = next;
			result[index] = previous;
			swapped = true;
		}
	}

	return result;
}

/**
 * Finds the indices that are part of a longest increasing subsequence; those
 * entries stay put, every other entry is reported as out of place.
 *
 * @param values - The target index of each entry, in source order.
 * @returns The source indices that do not need to move.
 */
function keptIndices(values: ReadonlyArray<number>): Set<number> {
	const lengths = values.map(() => 1);
	const previous = values.map(() => -1);
	let best = -1;
	for (let index = 0; index < values.length; index += 1) {
		for (let before = 0; before < index; before += 1) {
			if (
				(values[before] ?? 0) < (values[index] ?? 0) &&
				(lengths[before] ?? 0) + 1 > (lengths[index] ?? 0)
			) {
				lengths[index] = (lengths[before] ?? 0) + 1;
				previous[index] = before;
			}
		}

		if (best === -1 || (lengths[index] ?? 0) > (lengths[best] ?? 0)) {
			best = index;
		}
	}

	const kept = new Set<number>();
	for (let index = best; index !== -1; index = previous[index] ?? -1) {
		kept.add(index);
	}

	return kept;
}

/**
 * Picks what an out-of-place entry is reported against: the first earlier
 * entry that should follow it, else the last later entry that should precede
 * it.
 *
 * @param items - The entries in source order.
 * @param positions - The sorted index of each entry.
 * @param index - The source index of the out-of-place entry.
 * @returns The other entry and the message to use, if any.
 */
function findTarget(
	items: ReadonlyArray<SortableEntry>,
	positions: ReadonlyArray<number>,
	index: number,
): undefined | { entry: SortableEntry; messageId: MessageIds } {
	const position = positions[index] ?? 0;
	const before = items.find(
		(_other, otherIndex) => otherIndex < index && (positions[otherIndex] ?? 0) > position,
	);
	if (before !== undefined) {
		return { entry: before, messageId: "shouldBeBefore" };
	}

	const after = items.findLast(
		(_other, otherIndex) => otherIndex > index && (positions[otherIndex] ?? 0) < position,
	);
	return after === undefined ? undefined : { entry: after, messageId: "shouldBeAfter" };
}

/**
 * Builds the dotted path of a sequence, in the syntax of `yml/sort-keys`
 * (`""` for the root, `foo.bar[0].baz` for nested values).
 *
 * @param node - The sequence.
 * @param text - The source text, used for non-string keys.
 * @returns The path that `pathPattern` is tested against.
 */
function pathOf(node: AST.YAMLSequence, text: string): string {
	let path = "";
	let current: AST.YAMLNode = node;
	let parent: AST.YAMLNode | null = node.parent;
	while (parent !== null) {
		if (parent.type === "YAMLPair") {
			const key = unwrap(parent.key);
			let name = "";
			if (key !== null) {
				name =
					key.type === "YAMLScalar" && typeof key.value === "string"
						? key.value
						: text.slice(...key.range);
			}

			path = /^[$a-z_][\w$]*$/iu.test(name)
				? `.${name}${path}`
				: `[${JSON.stringify(name)}]${path}`;
		} else if (parent.type === "YAMLSequence") {
			path = `[${parent.entries.indexOf(current as EntryNode)}]${path}`;
		}

		current = parent;
		parent = "parent" in parent ? parent.parent : null;
	}

	return path.startsWith(".") ? path.slice(1) : path;
}

function toItem(entry: EntryNode | null, key: string): SortableEntry | undefined {
	const mapping = unwrap(entry);
	if (entry === null || mapping?.type !== "YAMLMapping") {
		return undefined;
	}

	const pair = mapping.pairs.find((candidate) => {
		const name = unwrap(candidate.key);
		return name?.type === "YAMLScalar" && String(name.value) === key;
	});
	const value = unwrap(pair?.value ?? null);
	if (
		value?.type !== "YAMLScalar" ||
		(typeof value.value !== "string" && typeof value.value !== "number")
	) {
		return undefined;
	}

	const item: SortableEntry = {
		aliases: new Set(),
		anchors: new Set(),
		node: entry,
		value: value.value,
	};
	collectAnchors(entry, item);
	return item;
}

function create(context: Context): TSESLint.RuleListener {
	const { options, sourceCode } = context;
	if (sourceCode.parserServices.isYAML !== true) {
		return {};
	}

	const specs = options.map((spec) => {
		const { caseSensitive = true, natural = false, type = "asc" } = spec.order ?? {};
		const order: ResolvedOrder = { caseSensitive, natural, type };
		// No `u` flag, matching yml: patterns such as `^a\-b$` stay valid.
		return { ...spec, order, pattern: new RegExp(spec.pathPattern) };
	});
	if (specs.length === 0) {
		return {};
	}

	/**
	 * Own-line comments directly above a block entry (no blank line between)
	 * travel with it.
	 *
	 * @param node - The entry.
	 * @returns The start offset of the entry's block.
	 */
	function leadingStart(node: AST.YAMLNode): number {
		const dash = sourceCode.getTokenBefore(node);
		const head = dash?.value === "-" ? dash : node;
		let start = head.range[0];
		let boundaryLine = head.loc.start.line;
		const comments = sourceCode.getCommentsBefore(head);
		for (let index = comments.length - 1; index >= 0; index -= 1) {
			const comment = comments[index];
			if (comment?.loc.end.line !== boundaryLine - 1) {
				break;
			}

			const before = sourceCode.getTokenBefore(comment, { includeComments: true });
			if (before !== null && before.loc.end.line === comment.loc.start.line) {
				break;
			}

			start = comment.range[0];
			boundaryLine = comment.loc.start.line;
		}

		return start;
	}

	function trailingEnd(node: AST.YAMLNode): number {
		const [comment] = sourceCode.getCommentsAfter(node);
		return comment?.loc.start.line === node.loc.end.line ? comment.range[1] : node.range[1];
	}

	function buildFix(
		sequence: AST.YAMLSequence,
		items: ReadonlyArray<SortableEntry>,
		sorted: ReadonlyArray<SortableEntry>,
	): TSESLint.ReportFixFunction | undefined {
		const text = sourceCode.getText();
		const isBlock = sequence.style === "block";
		const blocks: Array<EntrySpan> = items.map((item) => {
			return isBlock
				? { end: trailingEnd(item.node), item, start: leadingStart(item.node) }
				: { end: item.node.range[1], item, start: item.node.range[0] };
		});

		// A comment left in a gap belongs to no entry; moving entries around it
		// would re-attach it, so report without a fix.
		const gaps: Array<string> = [];
		for (let index = 1; index < blocks.length; index += 1) {
			const gap = text.slice(blocks[index - 1]?.end ?? 0, blocks[index]?.start ?? 0);
			if (isBlock ? /\S/u.test(gap) : gap.includes("#")) {
				return undefined;
			}

			gaps.push(gap);
		}

		const first = blocks[0];
		const last = blocks.at(-1);
		if (first === undefined || last === undefined) {
			return undefined;
		}

		const textByItem = new Map(
			blocks.map((block) => [block.item, text.slice(block.start, block.end)]),
		);
		const sortedText = sorted
			.map((item, index) => `${index === 0 ? "" : gaps[index - 1]}${textByItem.get(item)}`)
			.join("");
		return (fixer) => fixer.replaceTextRange([first.start, last.end], sortedText);
	}

	return {
		YAMLSequence(sequence: AST.YAMLSequence): void {
			if (sequence.entries.length < 2) {
				return;
			}

			const path = pathOf(sequence, sourceCode.getText());
			const spec = specs.find((candidate) => candidate.pattern.test(path));
			if (spec === undefined) {
				return;
			}

			const items: Array<SortableEntry> = [];
			for (const entry of sequence.entries) {
				const item = toItem(entry, spec.key);
				if (item === undefined) {
					return;
				}

				items.push(item);
			}

			const sorted = bubbleSort(items, makeIsValidOrder(spec.order));
			const positions = items.map((item) => sorted.indexOf(item));
			const kept = keptIndices(positions);
			if (kept.size === items.length) {
				return;
			}

			const fix = buildFix(sequence, items, sorted) ?? null;
			for (const [index, item] of items.entries()) {
				if (kept.has(index)) {
					continue;
				}

				const target = findTarget(items, positions, index);
				if (target === undefined) {
					continue;
				}

				context.report({
					data: {
						key: spec.key,
						orderText: orderText(spec.order),
						targetValue: String(target.entry.value),
						thisValue: String(item.value),
					},
					fix,
					loc: item.node.loc,
					messageId: target.messageId,
				});
			}
		},
	};
}

export const yamlSortSequenceByKey: EslintRuleModule<Options, MessageIds> = createEslintRule<
	Options,
	MessageIds,
	YAMLSourceCode
>({
	name: RULE_NAME,
	create,
	defaultOptions: [],
	meta: {
		defaultOptions: [],
		docs: {
			description: "Enforce sorted YAML sequences of mappings by a key",
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
