import { runAsWorker } from "synckit";

/**
 * One entry of the batched request sent by the rule: format `code` with oxfmt
 * and locate the `arrowIndex`-th arrow function (in source order) in the
 * formatted output. Requests are batched per linted file so a file pays the
 * worker round-trip cost once, not once per arrow.
 */
export interface FormatRequest {
	arrowIndex: number;
	code: string;
	printWidth: number;
	tabWidth: number;
}

/**
 * Response: whether the arrow (params through body) occupies a single line in
 * the formatted output, and that line's text for width measurement. `lineText`
 * is `null` when formatting failed or the arrow could not be located, which
 * callers must treat as "no verdict".
 */
export interface FormatResponse {
	lineText: null | string;
	singleLine: boolean;
}

/** An oxc AST node: offsets only, no `loc`/`range`. */
interface NodeLike {
	end: number;
	start: number;
	type: string;
}

function isNodeLike(value: unknown): value is NodeLike {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { type?: unknown }).type === "string" &&
		typeof (value as { start?: unknown }).start === "number" &&
		typeof (value as { end?: unknown }).end === "number"
	);
}

/**
 * Collects all arrow function nodes in the tree, ordered by source position.
 *
 * @param root - The parsed AST to search.
 * @returns All arrow function nodes, sorted by start offset.
 */
function collectArrows(root: unknown): Array<NodeLike> {
	const arrows: Array<NodeLike> = [];
	const stack: Array<unknown> = [root];

	while (stack.length > 0) {
		const current = stack.pop();
		if (typeof current !== "object" || current === null) {
			continue;
		}

		if (isNodeLike(current) && current.type === "ArrowFunctionExpression") {
			arrows.push(current);
		}

		for (const value of Object.values(current)) {
			if (Array.isArray(value)) {
				stack.push(...(value as Array<unknown>));
			} else if (typeof value === "object" && value !== null) {
				stack.push(value);
			}
		}
	}

	return arrows.sort((a, b) => a.start - b.start);
}

/**
 * Start offsets of every line in `code`, for offset-to-line lookups.
 *
 * @param code - The source text.
 * @returns Ascending offsets at which each line begins.
 */
function lineStartsOf(code: string): Array<number> {
	const starts = [0];
	for (let index = 0; index < code.length; index += 1) {
		if (code.charAt(index) === "\n") {
			starts.push(index + 1);
		}
	}

	return starts;
}

/**
 * Index (0-based) of the line containing `offset`.
 *
 * @param starts - Line start offsets from {@link lineStartsOf}.
 * @param offset - The source offset to locate.
 * @returns The containing line's index.
 */
function lineIndexOf(starts: Array<number>, offset: number): number {
	let low = 0;
	let high = starts.length - 1;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if ((starts[mid] ?? 0) <= offset) {
			low = mid;
		} else {
			high = mid - 1;
		}
	}

	return low;
}

async function formatOne(request: FormatRequest): Promise<FormatResponse> {
	const { format } = await import("oxfmt");
	const { parseSync } = await import("oxc-parser");

	const result = await format("snippet.tsx", request.code, {
		endOfLine: "lf",
		printWidth: request.printWidth,
		semi: true,
		tabWidth: request.tabWidth,
		useTabs: true,
	});
	if (result.errors.length > 0) {
		return { lineText: null, singleLine: false };
	}

	const parsed = parseSync("snippet.tsx", result.code);
	if (parsed.errors.length > 0) {
		return { lineText: null, singleLine: false };
	}

	const arrow = collectArrows(parsed.program)[request.arrowIndex];
	if (arrow === undefined) {
		return { lineText: null, singleLine: false };
	}

	const starts = lineStartsOf(result.code);
	const startLine = lineIndexOf(starts, arrow.start);
	const lineEnd = starts[startLine + 1] ?? result.code.length + 1;

	return {
		lineText: result.code.slice(starts[startLine], lineEnd - 1),
		singleLine: startLine === lineIndexOf(starts, arrow.end),
	};
}

runAsWorker(async (requests: Array<FormatRequest>): Promise<Array<FormatResponse>> => {
	const responses: Array<FormatResponse> = [];
	for (const request of requests) {
		responses.push(await formatOne(request));
	}

	return responses;
});
