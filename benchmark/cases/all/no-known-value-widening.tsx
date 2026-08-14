interface Owner {
	id: string;
}

const seed = { id: "1" };

export const widened: unknown = seed;

export const registry: Record<string, unknown> = { root: 1 };

export const asserted = { id: "1" } as object;

export function makeOwner(): unknown {
	return { id: "1" } satisfies Owner;
}
