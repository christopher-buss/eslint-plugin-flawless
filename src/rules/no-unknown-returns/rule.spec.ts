import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test";
import { noUnknownReturns, RULE_NAME } from "./rule";

const callbackMessageId = "unknownCallbackReturn";
const messageId = "unknownReturn";

const valid: Array<ValidTestCase> = [
	// No annotation, no report. The inferred return here IS `unknown`, and is
	// still out of scope: the rule is about a declared contract.
	unindent`
		declare const raw: unknown;

		export function loadConfig() {
			return raw;
		}
	`,
	unindent`
		export function run(): void {}
	`,
	// `any` is a different problem with a different fix, so the unknown flag is
	// tested rather than assignability.
	unindent`
		export declare function loadConfig(): any;
	`,
	unindent`
		export declare function loadConfig(): Promise<any>;
	`,
	// A type parameter resolves to itself, never to `unknown`.
	unindent`
		export function identity<T>(value: T): T {
			return value;
		}
	`,
	// A type parameter shadowing a file-level alias of the same name needs no
	// special casing: the checker resolves the name lexically.
	unindent`
		type Value = unknown;

		export function identity<Value>(value: Value): Value {
			return value;
		}
	`,
	// `NonNullable<unknown>` resolves to `{}`, which is not `unknown`.
	unindent`
		export function make(): NonNullable<unknown> {
			return {};
		}
	`,
	// Only the return type itself is in scope, not `unknown` nested inside it.
	unindent`
		export function all(): Array<unknown> {
			return [];
		}
	`,
	unindent`
		export function all(): Record<string, unknown> {
			return {};
		}
	`,
	unindent`
		export type Load = () => Array<unknown>;
	`,
	unindent`
		export function withRetry(makeError: () => void): void {}
	`,
	unindent`
		export async function loadConfig(): Promise<string> {
			return "";
		}
	`,
	// A named type that happens to be thenable is still what the caller
	// receives, so the promise unwrapping must not reach through it.
	unindent`
		interface Task {
			run(): void;
			then(onDone: (value: unknown) => void): void;
		}

		export declare function schedule(): Task;
	`,
	// The return type is `Generator`, not `unknown`: only the return type itself
	// is in scope, so a generator's yield type is not read.
	unindent`
		export function* walk(): Generator<unknown> {
			yield 1;
		}
	`,
	// Cross-file resolution is not over-eager: an imported alias that names a
	// real type passes.
	unindent`
		import type { Parsed } from "./no-unknown-returns/shared-result";

		export function loadConfig(): Parsed {
			return "";
		}
	`,
];

const invalid: Array<InvalidTestCase> = [
	// --- The declaration's own return, one per node type ---
	// FunctionDeclaration
	{
		code: unindent`
			export function loadConfig(): unknown {
				return 1;
			}
		`,
		errors: [{ messageId }],
	},
	// ArrowFunctionExpression
	{
		code: unindent`
			export const loadConfig = (): unknown => 1;
		`,
		errors: [{ messageId }],
	},
	// FunctionExpression
	{
		code: unindent`
			export const loadConfig = function (): unknown {
				return 1;
			};
		`,
		errors: [{ messageId }],
	},
	// TSDeclareFunction
	{
		code: unindent`
			export declare function loadConfig(): unknown;
		`,
		errors: [{ messageId }],
	},
	// TSEmptyBodyFunctionExpression
	{
		code: unindent`
			export abstract class Loader {
				abstract load(): unknown;
			}
		`,
		errors: [{ messageId }],
	},
	// TSCallSignatureDeclaration
	{
		code: unindent`
			export interface Loader {
				(): unknown;
			}
		`,
		errors: [{ messageId }],
	},
	// TSConstructSignatureDeclaration
	{
		code: unindent`
			export interface LoaderClass {
				new (): unknown;
			}
		`,
		errors: [{ messageId }],
	},
	// TSConstructorType — a type expression like TSFunctionType, so it takes the
	// same wording: this code holds the type and calls it, and does not own the
	// body the other message would tell it to fix.
	{
		code: unindent`
			export type LoaderClass = new () => unknown;
		`,
		errors: [{ messageId: callbackMessageId }],
	},
	{
		code: unindent`
			export declare function build(make: new () => unknown): void;
		`,
		errors: [{ messageId: callbackMessageId }],
	},
	// TSMethodSignature
	{
		code: unindent`
			export interface Loader {
				load(): unknown;
			}
		`,
		errors: [{ messageId }],
	},
	// TSFunctionType — the one form that types a function value supplied from
	// elsewhere, so the report is worded for the code that calls it.
	{
		code: unindent`
			export type Load = () => unknown;
		`,
		errors: [{ messageId: callbackMessageId }],
	},

	// A getter and an object literal method both reach the rule through
	// FunctionExpression, and each overload signature reports separately.
	{
		code: unindent`
			export class Store {
				get value(): unknown {
					return 1;
				}
			}
		`,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			export const store = {
				read(): unknown {
					return 1;
				},
			};
		`,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			export declare function read(key: string): unknown;
			export declare function read(key: number): unknown;
		`,
		errors: [{ messageId }, { messageId }],
	},

	// --- Promise unwrapping ---
	{
		code: unindent`
			export async function loadConfig(): Promise<unknown> {
				return 1;
			}
		`,
		errors: [{ messageId }],
	},
	// Nested promises collapse: the awaited type is resolved to the end.
	{
		code: unindent`
			export declare function loadConfig(): Promise<Promise<unknown>>;
		`,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			export const loadConfig = function (): PromiseLike<unknown> {
				return Promise.resolve(1);
			};
		`,
		errors: [{ messageId }],
	},

	// --- Type resolution the checker does for free ---
	// TS absorbs `string | unknown` into `unknown`, so no union walk is needed
	// and the case still reports.
	{
		code: unindent`
			export function loadConfig(): string | unknown {
				return "";
			}
		`,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			export function loadConfig(): (unknown) {
				return 1;
			}
		`,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			type Result = unknown;

			export function loadConfig(): Result {
				return 1;
			}
		`,
		errors: [{ messageId }],
	},
	// An alias chain, resolved by the checker rather than walked.
	{
		code: unindent`
			type Outer = Inner;
			type Inner = unknown;

			export function loadConfig(): Outer {
				return 1;
			}
		`,
		errors: [{ messageId }],
	},
	// The reason for going type-aware: an alias moved into a shared types file
	// still reports. A syntactic rule sees only this file's aliases, so the move
	// would look like compliance while the code is unchanged.
	{
		code: unindent`
			import type { Result } from "./no-unknown-returns/shared-result";

			export function loadConfig(): Result {
				return 1;
			}
		`,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			import type { AsyncResult } from "./no-unknown-returns/shared-result";

			export function loadConfig(): AsyncResult {
				return Promise.resolve(1);
			}
		`,
		errors: [{ messageId }],
	},
	// A generic alias resolves too, so discarding its type argument is caught.
	{
		code: unindent`
			type Ignored<T> = unknown;

			export function loadConfig(): Ignored<string> {
				return 1;
			}
		`,
		errors: [{ messageId }],
	},

	// --- Parameter and property position ---
	{
		code: unindent`
			export function withRetry(makeError: () => unknown): void {}
		`,
		errors: [{ messageId: callbackMessageId }],
	},
	// A function type nested in an inline object type in a parameter.
	{
		code: unindent`
			export function make(overrides: { encode?: (job: string) => unknown }): void {}
		`,
		errors: [{ messageId: callbackMessageId }],
	},
	{
		code: unindent`
			export interface Options {
				encode: (item: string) => unknown;
			}
		`,
		errors: [{ messageId: callbackMessageId }],
	},
	{
		code: unindent`
			export class Writer {
				private readonly encode!: (item: string) => unknown;
			}
		`,
		errors: [{ messageId: callbackMessageId }],
	},
	{
		code: unindent`
			export type Enc = (item: string) => unknown;
		`,
		errors: [{ messageId: callbackMessageId }],
	},
	// The any-function wildcard is NOT exempt. `(...args: never) => void`
	// classifies identically and is more honest, since these sites discard the
	// return — so the report has a truthful fix.
	{
		code: unindent`
			interface Registry {
				load: (id: string) => string;
				version: number;
			}

			export type Loaders = Extract<Registry[keyof Registry], (...args: never) => unknown>;
		`,
		errors: [{ messageId: callbackMessageId }],
	},
	{
		code: unindent`
			export type ReturnOf<T> = T extends (...args: never) => unknown ? T : never;
		`,
		errors: [{ messageId: callbackMessageId }],
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: noUnknownReturns,
	valid,
});
