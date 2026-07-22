export interface LocalThing {
	readonly __local: true;
}
export function makeLocal(): LocalThing {
	return { __local: true };
}
