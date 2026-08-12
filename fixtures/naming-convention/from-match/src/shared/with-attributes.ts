/**
 * Default export: the canonical helper whose explicit type argument names the
 * attributes of the instance it wraps. Exercises `typeArgumentOf` against a
 * default export, imported both directly and under an alias.
 *
 * @param instance - The instance the attributes belong to.
 * @returns The instance, typed by the caller's type argument.
 */
export default function withAttributes<T extends object>(instance: object): T {
	return instance as T;
}

/**
 * Named export declaring the same shape, so the named-import and
 * aliased-named-import paths can be tested independently of the default one.
 *
 * @param instance - The instance the tags belong to.
 * @returns The instance, typed by the caller's type argument.
 */
export function withTags<T extends object>(instance: object): T {
	return instance as T;
}

/**
 * Second named export, for configs that list more than one callee.
 *
 * @param instance - The instance the metadata belongs to.
 * @returns The instance, typed by the caller's type argument.
 */
export function withMetadata<T extends object>(instance: object): T {
	return instance as T;
}

/** Constructed rather than called, so `new` expressions can be tested. */
export class AttributeMap<T extends object> {
	constructor(public readonly attributes: T) {}
}

/** A generic *type*, to prove type-reference arguments are not call arguments. */
export type Attributes<T extends object> = T;
