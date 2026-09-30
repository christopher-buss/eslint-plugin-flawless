declare function parseConfig(value: unknown): void;

export function isString(value: unknown): value is string {
	return typeof value === "string";
}

export function wrap(message: string, cause: unknown): Error {
	return new Error(message, { cause });
}

export function logError(cause: unknown): void {
	console.log(cause);
}

export const decode = (payload: string | unknown): void => {
	parseConfig(payload);
};

export function toError(cause: unknown): Error;
export function toError(cause: unknown): Error {
	return cause instanceof Error ? cause : new Error(String(cause), { cause });
}

export interface Parser {
	parse(input: unknown): void;
}
