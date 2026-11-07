import type { Tagged } from "tagger";

export type Box<T> = number & { readonly __box: T };
export type ReadonlyData<T> = Tagged<T, "Readonly">;
export declare function register<T>(): Box<ReadonlyData<T>>;
