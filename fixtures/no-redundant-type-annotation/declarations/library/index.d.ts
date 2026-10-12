declare const tag: unique symbol;
export type Tagged<Type, Name extends PropertyKey> = Type & {
	readonly [tag]: { [K in Name]: true };
};
