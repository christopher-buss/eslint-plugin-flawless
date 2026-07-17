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

interface NodeLike {
	loc: { end: { line: number }; start: { line: number } };
	range: [number, number];
	type: string;
}

function isNodeLike(value: unknown): value is NodeLike {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { type?: unknown }).type === "string" &&
		Array.isArray((value as { range?: unknown }).range)
	);
}

/**
 * Collects all arrow function nodes in the tree, ordered by source position.
 *
 * @param root - The parsed AST to search.
 * @returns All arrow function nodes, sorted by range start.
 */
function collectArrows(root: unknown): Array<NodeLike> {
	const arrows: Array<NodeLike> = [];
	const stack: Array<unknown> = [root];
	const seen = new Set<unknown>();

	while (stack.length > 0) {
		const current = stack.pop();
		if (typeof current !== "object" || current === null || seen.has(current)) {
			continue;
		}

		seen.add(current);
		if (isNodeLike(current) && current.type === "ArrowFunctionExpression") {
			arrows.push(current);
		}

		for (const [key, value] of Object.entries(current)) {
			if (key === "parent") {
				continue;
			}

			if (Array.isArray(value)) {
				stack.push(...(value as Array<unknown>));
			} else if (typeof value === "object" && value !== null) {
				stack.push(value);
			}
		}
	}

	return arrows.sort((a, b) => a.range[0] - b.range[0]);
}

async function formatOne(request: FormatRequest): Promise<FormatResponse> {
	const { format } = await import("oxfmt");
	const { parse } = await import("@typescript-eslint/parser");

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

	const program = parse(result.code, {
		ecmaFeatures: { jsx: true },
		loc: true,
		range: true,
	});
	const arrow = collectArrows(program)[request.arrowIndex];
	if (arrow === undefined) {
		return { lineText: null, singleLine: false };
	}

	return {
		lineText: result.code.split("\n")[arrow.loc.start.line - 1] ?? null,
		singleLine: arrow.loc.start.line === arrow.loc.end.line,
	};
}

runAsWorker(async (requests: Array<FormatRequest>): Promise<Array<FormatResponse>> => {
	const responses: Array<FormatResponse> = [];
	for (const request of requests) {
		responses.push(await formatOne(request));
	}

	return responses;
});
