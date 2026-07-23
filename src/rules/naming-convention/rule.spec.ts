// cspell:ignore isfoo, goodfun, VanFooBar, typeparam, myfoo, syncbar
import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";
import path from "node:path";

import { run } from "../test";
import { namingConvention, type Options, RULE_NAME } from "./rule";

// Shared options for the contextual-type-dictated name cases: only object
// literal members are configured, so any skip/report comes from that path.
const dictatedNameOptions: Options = [
	{
		format: ["camelCase"],
		selector: ["objectLiteralMethod", "objectLiteralProperty"],
	},
];

const valid: Array<ValidTestCase> = [
	{
		code: `
        const child_process = require('child_process');
      `,
		options: [
			{
				filter: {
					match: false,
					regex: "child_process",
				},
				format: ["camelCase"],
				selector: "default",
			},
		],
	},
	{
		code: `
        declare const ANY_UPPER_CASE: any;
        declare const ANY_UPPER_CASE: any | null;
        declare const ANY_UPPER_CASE: any | null | undefined;

        declare const string_camelCase: string;
        declare const string_camelCase: string | null;
        declare const string_camelCase: string | null | undefined;
        declare const string_camelCase: 'a' | null | undefined;
        declare const string_camelCase: string | 'a' | null | undefined;

        declare const number_camelCase: number;
        declare const number_camelCase: number | null;
        declare const number_camelCase: number | null | undefined;
        declare const number_camelCase: 1 | null | undefined;
        declare const number_camelCase: number | 2 | null | undefined;

        declare const boolean_camelCase: boolean;
        declare const boolean_camelCase: boolean | null;
        declare const boolean_camelCase: boolean | null | undefined;
        declare const boolean_camelCase: true | null | undefined;
        declare const boolean_camelCase: false | null | undefined;
        declare const boolean_camelCase: true | false | null | undefined;
      `,
		options: [
			{
				format: ["UPPER_CASE"],
				modifiers: ["const"],
				prefix: ["ANY_"],
				selector: "variable",
			},
			{
				format: ["camelCase"],
				prefix: ["string_"],
				selector: "variable",
				types: ["string"],
			},
			{
				format: ["camelCase"],
				prefix: ["number_"],
				selector: "variable",
				types: ["number"],
			},
			{
				format: ["camelCase"],
				prefix: ["boolean_"],
				selector: "variable",
				types: ["boolean"],
			},
		],
	},
	{
		code: `
        let foo = 'a';
        const _foo = 1;
        interface Foo {}
        class Bar {}
        function foo_function_bar() {}
      `,
		options: [
			{
				custom: {
					match: false,
					regex: /^unused_\w/.source,
				},
				format: ["camelCase"],
				leadingUnderscore: "allow",
				selector: "default",
			},
			{
				custom: {
					match: false,
					regex: /^I[A-Z]/.source,
				},
				format: ["PascalCase"],
				selector: "typeLike",
			},
			{
				custom: {
					match: true,
					regex: /_function_/.source,
				},
				format: ["snake_case"],
				leadingUnderscore: "allow",
				selector: "function",
			},
		],
	},
	{
		code: `
        let foo = 'a';
        const _foo = 1;
        interface foo {}
        class bar {}
        function fooFunctionBar() {}
        function _fooFunctionBar() {}
      `,
		options: [
			{
				custom: {
					match: false,
					regex: /^unused_\w/.source,
				},
				format: ["camelCase"],
				leadingUnderscore: "allow",
				selector: ["default", "typeLike", "function"],
			},
		],
	},
	{
		code: `
        const match = 'test'.match(/test/);
        const [, key, value] = match;
      `,
		options: [
			{
				format: ["camelCase"],
				selector: "default",
			},
		],
	},
	// no format selector
	{
		code: "const snake_case = 1;",
		options: [
			{
				format: ["camelCase"],
				selector: "default",
			},
			{
				format: null,
				selector: "variable",
			},
		],
	},
	{
		code: "const snake_case = 1;",
		options: [
			{
				format: ["camelCase"],
				selector: "default",
			},
			{
				format: [],
				selector: "variable",
			},
		],
	},
	// https://github.com/typescript-eslint/typescript-eslint/issues/1478
	{
		code: `
        const child_process = require('child_process');
      `,
		options: [
			{ format: ["camelCase", "UPPER_CASE"], selector: "variable" },
			{
				filter: "child_process",
				format: ["snake_case"],
				selector: "variable",
			},
		],
	},
	{
		code: `
        const foo = {
          'Property-Name': 'asdf',
        };
      `,
		options: [
			{
				filter: {
					match: false,
					regex: /-/.source,
				},
				format: ["strictCamelCase"],
				selector: "default",
			},
		],
	},
	{
		code: `
        const foo = {
          'Property-Name': 'asdf',
        };
      `,
		options: [
			{
				filter: {
					match: false,
					regex: /^(Property-Name)$/.source,
				},
				format: ["strictCamelCase"],
				selector: "default",
			},
		],
	},
	{
		code: `
        let isFoo = 1;
        class foo {
          shouldBoo: number;
        }
      `,
		options: [
			{
				format: ["PascalCase"],
				prefix: ["is", "should", "has", "can", "did", "will"],
				selector: ["variable", "parameter", "property", "accessor"],
				types: ["number"],
			},
		],
	},
	{
		code: `
        class foo {
          private readonly FooBoo: boolean;
        }
      `,
		options: [
			{
				format: ["PascalCase"],
				modifiers: ["private", "readonly"],
				selector: ["property", "accessor"],
				types: ["boolean"],
			},
		],
	},
	{
		code: `
        class foo {
          private fooBoo: number;
        }
      `,
		options: [
			{
				format: ["camelCase"],
				modifiers: ["private"],
				selector: ["property", "accessor"],
			},
		],
	},
	{
		code: `
        const isfooBar = 1;
        function fun(goodfunFoo: number) {}
        class foo {
          private VanFooBar: number;
        }
      `,
		options: [
			{
				format: ["StrictPascalCase"],
				modifiers: ["private"],
				prefix: ["Van"],
				selector: ["property", "accessor"],
			},
			{
				format: ["camelCase"],
				prefix: ["is", "good"],
				selector: ["variable", "parameter"],
				types: ["number"],
			},
		],
	},
	{
		code: `
        class SomeClass {
          static OtherConstant = 'hello';
        }

        export const { OtherConstant: otherConstant } = SomeClass;
      `,
		options: [
			{ format: ["PascalCase"], selector: "property" },
			{ format: ["camelCase"], selector: "variable" },
		],
	},
	// treat properties with function expressions as typeMethod
	{
		code: `
        interface SOME_INTERFACE {
          SomeMethod: () => void;

          some_property: string;
        }
      `,
		options: [
			{
				format: ["UPPER_CASE"],
				selector: "default",
			},
			{
				format: ["PascalCase"],
				selector: "typeMethod",
			},
			{
				format: ["snake_case"],
				selector: "typeProperty",
			},
		],
	},
	{
		code: `
        type Ignored = {
          ignored_due_to_modifiers: string;
          readonly FOO: string;
        };
      `,
		options: [
			{
				format: ["UPPER_CASE"],
				modifiers: ["readonly"],
				selector: "typeProperty",
			},
		],
	},
	{
		code: `
        const camelCaseVar = 1;
        enum camelCaseEnum {}
        class camelCaseClass {}
        function camelCaseFunction() {}
        interface camelCaseInterface {}
        type camelCaseType = {};
        export const PascalCaseVar = 1;
        export enum PascalCaseEnum {}
        export class PascalCaseClass {}
        export function PascalCaseFunction() {}
        export interface PascalCaseInterface {}
        export type PascalCaseType = {};
      `,
		options: [
			{ format: ["camelCase"], selector: "default" },
			{
				format: ["PascalCase"],
				modifiers: ["exported"],
				selector: "variable",
			},
			{
				format: ["PascalCase"],
				modifiers: ["exported"],
				selector: "function",
			},
			{
				format: ["PascalCase"],
				modifiers: ["exported"],
				selector: "class",
			},
			{
				format: ["PascalCase"],
				modifiers: ["exported"],
				selector: "interface",
			},
			{
				format: ["PascalCase"],
				modifiers: ["exported"],
				selector: "typeAlias",
			},
			{
				format: ["PascalCase"],
				modifiers: ["exported"],
				selector: "enum",
			},
		],
	},
	{
		code: `
        const camelCaseVar = 1;
        enum camelCaseEnum {}
        class camelCaseClass {}
        function camelCaseFunction() {}
        interface camelCaseInterface {}
        type camelCaseType = {};
        const PascalCaseVar = 1;
        enum PascalCaseEnum {}
        class PascalCaseClass {}
        function PascalCaseFunction() {}
        interface PascalCaseInterface {}
        type PascalCaseType = {};
        export {
          PascalCaseVar,
          PascalCaseEnum,
          PascalCaseClass,
          PascalCaseFunction,
          PascalCaseInterface,
          PascalCaseType,
        };
      `,
		options: [
			{ format: ["camelCase"], selector: "default" },
			{
				format: ["PascalCase"],
				modifiers: ["exported"],
				selector: "variable",
			},
			{
				format: ["PascalCase"],
				modifiers: ["exported"],
				selector: "function",
			},
			{
				format: ["PascalCase"],
				modifiers: ["exported"],
				selector: "class",
			},
			{
				format: ["PascalCase"],
				modifiers: ["exported"],
				selector: "interface",
			},
			{
				format: ["PascalCase"],
				modifiers: ["exported"],
				selector: "typeAlias",
			},
			{
				format: ["PascalCase"],
				modifiers: ["exported"],
				selector: "enum",
			},
		],
	},
	{
		code: `
        {
          const camelCaseVar = 1;
          function camelCaseFunction() {}
          declare function camelCaseDeclaredFunction();
        }
        const PascalCaseVar = 1;
        function PascalCaseFunction() {}
        declare function PascalCaseDeclaredFunction();
      `,
		options: [
			{ format: ["camelCase"], selector: "default" },
			{
				format: ["PascalCase"],
				modifiers: ["global"],
				selector: "variable",
			},
			{
				format: ["PascalCase"],
				modifiers: ["global"],
				selector: "function",
			},
		],
	},
	{
		code: `
        const { some_name1 } = {};
        const { ignore: IgnoredDueToModifiers1 } = {};
        const { some_name2 = 2 } = {};
        const IgnoredDueToModifiers2 = 1;
      `,
		options: [
			{
				format: ["PascalCase"],
				selector: "default",
			},
			{
				format: ["snake_case"],
				modifiers: ["destructured"],
				selector: "variable",
			},
		],
	},
	{
		code: `
        const { some_name1 } = {};
        const { ignore: IgnoredDueToModifiers1 } = {};
        const { some_name2 = 2 } = {};
        const IgnoredDueToModifiers2 = 1;
      `,
		options: [
			{
				format: ["PascalCase"],
				selector: "default",
			},
			{
				format: null,
				modifiers: ["destructured"],
				selector: "variable",
			},
		],
	},
	{
		code: `
        export function Foo(
          { aName },
          { anotherName = 1 },
          { ignored: IgnoredDueToModifiers1 },
          { ignored: IgnoredDueToModifiers1 = 2 },
          IgnoredDueToModifiers2,
        ) {}
      `,
		options: [
			{
				format: ["PascalCase"],
				selector: "default",
			},
			{
				format: ["camelCase"],
				modifiers: ["destructured"],
				selector: "parameter",
			},
		],
	},
	{
		code: `
        class Ignored {
          private static abstract readonly some_name;
          IgnoredDueToModifiers = 1;
        }
      `,
		options: [
			{
				format: ["PascalCase"],
				selector: "default",
			},
			{
				format: ["snake_case"],
				modifiers: ["static", "readonly"],
				selector: "classProperty",
			},
		],
	},
	{
		code: `
        class Ignored {
          constructor(
            private readonly some_name,
            IgnoredDueToModifiers,
          ) {}
        }
      `,
		options: [
			{
				format: ["PascalCase"],
				selector: "default",
			},
			{
				format: ["snake_case"],
				modifiers: ["readonly"],
				selector: "parameterProperty",
			},
		],
	},
	{
		code: `
        class Ignored {
          private static abstract some_name();
          IgnoredDueToModifiers() {}
        }
      `,
		options: [
			{
				format: ["PascalCase"],
				selector: "default",
			},
			{
				format: ["snake_case"],
				modifiers: ["abstract", "static"],
				selector: "classMethod",
			},
		],
	},
	{
		code: `
        class Ignored {
          private static get some_name() {}
          get IgnoredDueToModifiers() {}
        }
      `,
		options: [
			{
				format: ["PascalCase"],
				selector: "default",
			},
			{
				format: ["snake_case"],
				modifiers: ["private", "static"],
				selector: "accessor",
			},
		],
	},
	{
		code: `
        abstract class some_name {}
        class IgnoredDueToModifier {}
      `,
		options: [
			{
				format: ["PascalCase"],
				selector: "default",
			},
			{
				format: ["snake_case"],
				modifiers: ["abstract"],
				selector: "class",
			},
		],
	},
	{
		code: `
        const UnusedVar = 1;
        function UnusedFunc(
          // this line is intentionally broken out
          UnusedParam: string,
        ) {}
        class UnusedClass {}
        interface UnusedInterface {}
        type UnusedType<
          // this line is intentionally broken out
          UnusedTypeParam,
        > = {};

        export const used_var = 1;
        export function used_func(
          // this line is intentionally broken out
          used_param: string,
        ) {
          return used_param;
        }
        export class used_class {}
        export interface used_interface {}
        export type used_type<
          // this line is intentionally broken out
          used_typeparam,
        > = used_typeparam;
      `,
		options: [
			{
				format: ["snake_case"],
				selector: "default",
			},
			{
				format: ["PascalCase"],
				modifiers: ["unused"],
				selector: "default",
			},
		],
	},
	{
		code: `
        const ignored1 = {
          'a a': 1,
          'b b'() {},
          get 'c c'() {
            return 1;
          },
          set 'd d'(value: string) {},
        };
        class ignored2 {
          'a a' = 1;
          'b b'() {}
          get 'c c'() {
            return 1;
          }
          set 'd d'(value: string) {}
        }
        interface ignored3 {
          'a a': 1;
          'b b'(): void;
        }
        type ignored4 = {
          'a a': 1;
          'b b'(): void;
        };
        enum ignored5 {
          'a a',
        }
      `,
		options: [
			{
				format: ["snake_case"],
				selector: "default",
			},
			{
				format: null,
				modifiers: ["requiresQuotes"],
				selector: "default",
			},
		],
	},
	{
		code: `
        const ignored1 = {
          'a a': 1,
          'b b'() {},
          get 'c c'() {
            return 1;
          },
          set 'd d'(value: string) {},
        };
        class ignored2 {
          'a a' = 1;
          'b b'() {}
          get 'c c'() {
            return 1;
          }
          set 'd d'(value: string) {}
        }
        interface ignored3 {
          'a a': 1;
          'b b'(): void;
        }
        type ignored4 = {
          'a a': 1;
          'b b'(): void;
        };
        enum ignored5 {
          'a a',
        }
      `,
		options: [
			{
				format: ["snake_case"],
				selector: "default",
			},
			{
				format: null,
				modifiers: ["requiresQuotes"],
				selector: [
					"classProperty",
					"objectLiteralProperty",
					"typeProperty",
					"classMethod",
					"objectLiteralMethod",
					"typeMethod",
					"accessor",
					"enumMember",
				],
			},
			// making sure the `requiresQuotes` modifier appropriately overrides
			// this
			{
				format: ["PascalCase"],
				selector: [
					"classProperty",
					"objectLiteralProperty",
					"typeProperty",
					"classMethod",
					"objectLiteralMethod",
					"typeMethod",
					"accessor",
					"enumMember",
				],
			},
		],
	},
	{
		code: `
        const obj = {
          Foo: 42,
          Bar() {
            return 42;
          },
        };
      `,
		options: [
			{
				format: ["camelCase"],
				selector: "memberLike",
			},
			{
				format: ["PascalCase"],
				selector: "property",
			},
			{
				format: ["PascalCase"],
				selector: "method",
			},
		],
	},
	{
		code: `
        const obj = {
          Bar() {
            return 42;
          },
          async async_bar() {
            return 42;
          },
        };
        class foo {
          public Bar() {
            return 42;
          }
          public async async_bar() {
            return 42;
          }
        }
        abstract class foo {
          public abstract Bar();
          public abstract async async_bar();
        }
      `,
		options: [
			{
				format: ["camelCase"],
				selector: "memberLike",
			},
			{
				format: ["snake_case"],
				modifiers: ["async"],
				selector: ["method", "objectLiteralMethod"],
			},
			{
				format: ["PascalCase"],
				selector: "method",
			},
		],
	},
	{
		code: `
        const async_bar1 = async () => {};
        async function async_bar2() {}
        const async_bar3 = async function async_bar4() {};
      `,
		options: [
			{
				format: ["camelCase"],
				selector: "memberLike",
			},
			{
				format: ["PascalCase"],
				selector: "method",
			},
			{
				format: ["snake_case"],
				modifiers: ["async"],
				selector: ["variable"],
			},
		],
	},
	{
		code: `
        class foo extends bar {
          public someAttribute = 1;
          public override some_attribute_override = 1;
          public someMethod() {
            return 42;
          }
          public override some_method_override2() {
            return 42;
          }
        }
        abstract class foo extends bar {
          public abstract someAttribute: string;
          public abstract override some_attribute_override: string;
          public abstract someMethod(): string;
          public abstract override some_method_override2(): string;
        }
      `,
		options: [
			{
				format: ["camelCase"],
				selector: "memberLike",
			},
			{
				format: ["snake_case"],
				modifiers: ["override"],
				selector: ["memberLike"],
			},
		],
	},
	{
		code: `
        class foo {
          private someAttribute = 1;
          #some_attribute = 1;

          private someMethod() {}
          #some_method() {}
        }
      `,
		options: [
			{
				format: ["camelCase"],
				selector: "memberLike",
			},
			{
				format: ["snake_case"],
				modifiers: ["#private"],
				selector: ["memberLike"],
			},
		],
	},
	{
		code: "import * as FooBar from 'foo_bar';",
		options: [
			{
				format: ["PascalCase"],
				selector: ["import"],
			},
			{
				format: ["camelCase"],
				modifiers: ["default"],
				selector: ["import"],
			},
		],
	},
	{
		code: "import fooBar from 'foo_bar';",
		options: [
			{
				format: ["PascalCase"],
				selector: ["import"],
			},
			{
				format: ["camelCase"],
				modifiers: ["default"],
				selector: ["import"],
			},
		],
	},
	{
		code: "import { default as fooBar } from 'foo_bar';",
		options: [
			{
				format: ["PascalCase"],
				selector: ["import"],
			},
			{
				format: ["camelCase"],
				modifiers: ["default"],
				selector: ["import"],
			},
		],
	},
	{
		code: "import { foo_bar } from 'foo_bar';",
		options: [
			{
				format: ["PascalCase"],
				selector: ["import"],
			},
			{
				format: ["camelCase"],
				modifiers: ["default"],
				selector: ["import"],
			},
		],
	},
	{
		code: "import { \"🍎\" as Foo } from 'foo_bar';",
		options: [
			{
				format: ["PascalCase"],
				selector: ["import"],
			},
		],
	},
	// objectStyleEnum tests
	{
		code: `
        const COLORS = { RED: 'red', BLUE: 'blue' } as const;
        const STATUS_CODES = { OK: 200, NOT_FOUND: 404 } as const;
        const API_ENDPOINTS = { USER: '/api/user', ORDER: '/api/order' } as const;
      `,
		options: [
			{
				format: ["UPPER_CASE"],
				selector: "objectStyleEnum",
			},
		],
	},
	{
		code: `
        const Colors = { Red: 'red', Blue: 'blue' } as const;
        const StatusCodes = { Ok: 200, NotFound: 404 } as const;
      `,
		options: [
			{
				format: ["PascalCase"],
				selector: "objectStyleEnum",
			},
		],
	},
	{
		code: `
        const colors = { red: 'red', blue: 'blue' } as const;
        const statusCodes = { ok: 200, notFound: 404 } as const;
      `,
		options: [
			{
				format: ["camelCase"],
				selector: "objectStyleEnum",
			},
		],
	},
	{
		code: `
        export const GLOBAL_COLORS = { RED: 'red', BLUE: 'blue' } as const;
        const localColors = { red: 'red', blue: 'blue' } as const;
      `,
		options: [
			{
				format: ["UPPER_CASE"],
				modifiers: ["exported"],
				selector: "objectStyleEnum",
			},
			{
				format: ["camelCase"],
				selector: "objectStyleEnum",
			},
		],
	},
	// Interface implementation should allow any naming format
	{
		code: `
        interface ILogEventSink {
          Emit(message: any): void;
          Process(data: string): string;
        }

        class LogEventOutputSink implements ILogEventSink {
          public Emit(message: any): void {
            console.log(message);
          }

          public Process(data: string): string {
            return data.toUpperCase();
          }
        }
      `,
		options: [
			{
				format: ["strictCamelCase"],
				selector: ["function", "classMethod"],
			},
		],
	},
	// Multiple interface implementation
	{
		code: `
        interface IDisposable {
          Dispose(): void;
        }

        interface ILogger {
          LogInfo(message: string): void;
          LogError(error: Error): void;
        }

        class FileLogger implements IDisposable, ILogger {
          public Dispose(): void {}
          public LogInfo(message: string): void {}
          public LogError(error: Error): void {}

          // Regular methods should still follow naming rules
          private formatMessage(msg: string): string {
            return msg;
          }
        }
      `,
		options: [
			{
				format: ["strictCamelCase"],
				selector: ["function", "classMethod"],
			},
		],
	},
	// Interface with generic methods
	{
		code: `
        interface IRepository<T> {
          GetById(id: string): T | null;
          SaveEntity(entity: T): void;
        }

        class UserRepository implements IRepository<User> {
          public GetById(id: string): User | null {
            return null;
          }

          public SaveEntity(entity: User): void {
            // save logic
          }
        }
      `,
		options: [
			{
				format: ["strictCamelCase"],
				selector: ["function", "classMethod"],
			},
		],
	},
	{
		// type reference (loose name-only) - matches Entity from a typed call
		code: "type Entity<TData = unknown> = { readonly __type: TData }; declare const world: { component<T = unknown>(): Entity<T> }; const Health = world.component();",
		options: [
			{
				format: ["PascalCase"],
				modifiers: ["const"],
				selector: "variable",
				types: [{ name: "Entity" }],
			},
		],
	},
	{
		// type reference - matches an alias chain through a Tag subtype
		code: "type Entity<TData = unknown> = { readonly __type: TData }; type TagDiscriminator = { readonly __tag: true }; type Tag = Entity<TagDiscriminator>; declare function registerTag(): Tag; const Dead = registerTag();",
		options: [
			{
				format: ["PascalCase"],
				modifiers: ["const"],
				selector: "variable",
				types: [{ name: "Entity" }],
			},
		],
	},
	{
		// type reference - matches branded Pair from pair()
		code: "type Pair<P = unknown, O = unknown> = { readonly __pred: P; readonly __obj: O }; declare function pair<P, O>(p: P, o: O): Pair<P, O>; const MaxHealth = pair(1, 2);",
		options: [
			{
				format: ["PascalCase"],
				modifiers: ["const"],
				selector: "variable",
				types: [{ name: "Pair" }],
			},
		],
	},
	{
		// type reference - single config allows multiple referenced types
		code: "type Entity<TData = unknown> = { readonly __type: TData }; type Pair<P = unknown, O = unknown> = { readonly __pred: P; readonly __obj: O }; declare function component<T = unknown>(): Entity<T>; declare function pair<P, O>(p: P, o: O): Pair<P, O>; const Health = component(); const MaxHealth = pair(1, 2);",
		options: [
			{
				format: ["PascalCase"],
				modifiers: ["const"],
				selector: "variable",
				types: [{ name: "Entity" }, { name: "Pair" }],
			},
		],
	},
	{
		// type reference - union of (Entity | Pair) matches when each arm hits
		// some configured type
		code: "type Entity<TData = unknown> = { readonly __type: TData }; type Pair<P = unknown, O = unknown> = { readonly __pred: P; readonly __obj: O }; type Id<T = unknown> = Entity<T> | Pair<T, unknown>; declare function resolveId<T>(): Id<T>; const ResolvedId = resolveId();",
		options: [
			{
				format: ["PascalCase"],
				modifiers: ["const"],
				selector: "variable",
				types: [{ name: "Entity" }, { name: "Pair" }],
			},
		],
	},
	{
		// type reference - optional union flows through getNonNullableType
		code: "type Entity<TData = unknown> = { readonly __type: TData }; declare function component<T = unknown>(): Entity<T> | undefined; const Health = component();",
		options: [
			{
				format: ["PascalCase"],
				modifiers: ["const"],
				selector: "variable",
				types: [{ name: "Entity" }],
			},
		],
	},
	{
		// type reference miss - non-Entity type falls back to default rule
		code: "const myCount: number = 1;",
		options: [
			{
				format: ["PascalCase"],
				modifiers: ["const"],
				selector: "variable",
				types: [{ name: "Entity" }],
			},
			{ format: ["camelCase"], selector: "variable" },
		],
	},
	{
		// type reference - structural type (no nominal brand symbol) matches by
		// alias name alone; confirms the matcher does not rely on a brand pattern
		code: "type ServerEvents<T> = { fire(event: keyof T): void }; declare function createServer<T>(handlers: T): ServerEvents<T>; const Events = createServer({ x: 1 });",
		options: [
			{
				format: ["PascalCase"],
				modifiers: ["const"],
				selector: "variable",
				types: [{ name: "ServerEvents" }],
			},
		],
	},
	{
		// type reference - nested union INSIDE an intersection matches via the
		// recursive union branch
		code: "type Entity<T = unknown> = { readonly __type: T }; type Pair<P = unknown, O = unknown> = { readonly __pred: P; readonly __obj: O }; type Inner = Pair<1, 2> | Pair<3, 4>; type Combined = Entity<unknown> & Inner; declare function make(): Combined; const Made = make();",
		options: [
			{
				format: ["PascalCase"],
				modifiers: ["const"],
				selector: "variable",
				types: [{ name: "Entity" }, { name: "Pair" }],
			},
		],
	},
	{
		// returns matcher - anonymous function type matched by its return type
		code: "type Node = { readonly __node: true }; declare function createProbe(): (props: { label: string }) => Node; const Probe = createProbe();",
		options: [
			{
				format: ["PascalCase"],
				modifiers: ["const"],
				selector: "variable",
				types: [{ returns: { name: "Node" } }],
			},
		],
	},
	{
		// returns matcher - nullable return type matches via the union branch
		code: "type Node = { readonly __node: true }; declare function createProbe(): () => Node | undefined; const Probe = createProbe();",
		options: [
			{
				format: ["PascalCase"],
				modifiers: ["const"],
				selector: "variable",
				types: [{ returns: { name: "Node" } }],
			},
		],
	},
	{
		// returns matcher - combined with `name`: both constraints hold
		code: "type Node = { readonly __node: true }; type Component = () => Node; declare function make(): Component; const Probe = make();",
		options: [
			{
				format: ["PascalCase"],
				modifiers: ["const"],
				selector: "variable",
				types: [{ name: "Component", returns: { name: "Node" } }],
			},
		],
	},
	{
		// returns matcher - non-callable type falls back to the default rule
		code: "const myCount: number = 1;",
		options: [
			{
				format: ["PascalCase"],
				modifiers: ["const"],
				selector: "variable",
				types: [{ returns: { name: "Node" } }],
			},
			{ format: ["camelCase"], selector: "variable" },
		],
	},
	{
		// returns matcher on typeMethod - interface methods returning a component
		// type get their own format; other methods keep the base format
		code: "type Node = { readonly __node: true }; interface Api { FluxProvider(props: { x: number }): Node; getCount(): number; }",
		options: [
			{
				format: ["PascalCase"],
				selector: "typeMethod",
				types: [{ returns: { name: "Node" } }],
			},
			{ format: ["camelCase"], selector: "typeMethod" },
		],
	},
	{
		// returns matcher on function declarations
		code: "type Node = { readonly __node: true }; function Probe(): Node { return { __node: true } as Node; }",
		options: [
			{
				format: ["PascalCase"],
				selector: "function",
				types: [{ returns: { name: "Node" } }],
			},
			{ format: ["camelCase"], selector: "function" },
		],
	},
	{
		// fork divergence from upstream: `types` is honored (not ignored) on
		// function selectors — a function's type is never `string`, so this
		// config no longer applies to the declaration
		code: "function my_foo_bar() {}",
		options: [
			{
				format: ["PascalCase"],
				prefix: ["my", "My"],
				selector: ["variable", "function"],
				types: ["string"],
			},
		],
	},
	{
		// returns matcher on parameters - component passed as an argument
		code: "type Node = { readonly __node: true }; function mount(Component: (props: { x: number }) => Node) { return Component({ x: 1 }); }",
		options: [
			{
				format: ["PascalCase"],
				selector: "parameter",
				types: [{ returns: { name: "Node" } }],
			},
			{ format: ["camelCase"], selector: "parameter" },
		],
	},
	{
		// contextual type - names dictated by `satisfies Partial<T>` are not the
		// author's choice (mapped-type symbols), for both properties and methods
		code: "interface UserInputService { GetPropertyChangedSignal(): number; PreferredInput: number; } declare const preferred: number; const userInputService = { GetPropertyChangedSignal() { return 1; }, PreferredInput: preferred } satisfies Partial<UserInputService>;",
		options: dictatedNameOptions,
	},
	{
		// contextual type - plain `satisfies` against a non-mapped interface
		code: "interface Config { PascalProp: number } const x = { PascalProp: 1 } satisfies Config;",
		options: dictatedNameOptions,
	},
	{
		// contextual type - variable type annotation
		code: "interface Config { PascalProp: number } const x: Config = { PascalProp: 1 };",
		options: dictatedNameOptions,
	},
	{
		// contextual type - `as` assertion
		code: "interface Config { PascalProp: number } const x = { PascalProp: 1 } as Config;",
		options: dictatedNameOptions,
	},
	{
		// contextual type - call argument position
		code: "interface Config { PascalProp: number } declare function configure(config: Config): void; configure({ PascalProp: 1 });",
		options: dictatedNameOptions,
	},
	{
		// contextual type - optional parameter (`Config | undefined` is stripped
		// via getNonNullableType)
		code: "interface Config { PascalProp: number } declare function configure(config?: Config): void; configure({ PascalProp: 1 });",
		options: dictatedNameOptions,
	},
	{
		// contextual type - nested object literal inherits the contextual type
		code: "interface Outer { inner: { PascalProp: number } } const x: Outer = { inner: { PascalProp: 1 } };",
		options: dictatedNameOptions,
	},
	{
		// contextual type - return position
		code: "interface Config { PascalProp: number } function make(): Config { return { PascalProp: 1 }; } const lazy: () => Config = () => ({ PascalProp: 1 });",
		options: dictatedNameOptions,
	},
	{
		// contextual type - shorthand property (the property name is dictated;
		// the variable itself is covered by the `variable` selector, which is
		// not configured here)
		code: "interface Config { PascalProp: number } declare const PascalProp: number; const x: Config = { PascalProp };",
		options: dictatedNameOptions,
	},
	{
		// contextual type - quoted key dictated by the type (requiresQuotes
		// interplay: skip fires before modifiers are computed)
		code: "interface Config { 'Weird Name': number } const x = { 'Weird Name': 1 } satisfies Config;",
		options: dictatedNameOptions,
	},
	{
		// contextual type - numeric key
		code: "interface Config { 0: string } const x = { 0: 'a' } satisfies Config;",
		options: dictatedNameOptions,
	},
	{
		// contextual type - `Record` over a literal key union produces real
		// properties, so the exact name is dictated
		code: "const x: Record<'ExactName', number> = { ExactName: 1 };",
		options: dictatedNameOptions,
	},
	{
		// contextual type - union contextual type where the property exists in
		// only one arm (per-arm lookup, not union-wide)
		code: "interface ConfigA { OnlyA: number } interface ConfigB { onlyB: number } declare function f(x: ConfigA | ConfigB): void; f({ OnlyA: 1 });",
		options: dictatedNameOptions,
	},
	{
		// contextual type - spread siblings do not affect the lookup
		code: "interface Config { PascalProp: number; other: number } declare const base: Config; const x: Config = { ...base, PascalProp: 1 };",
		options: dictatedNameOptions,
	},
];

const invalid: Array<InvalidTestCase> = [
	{
		// make sure we handle no options and apply defaults
		code: "const x_x = 1;",
		errors: [{ messageId: "doesNotMatchFormat" }],
	},
	{
		// make sure we handle empty options and apply defaults
		code: "const x_x = 1;",
		errors: [{ messageId: "doesNotMatchFormat" }],
		options: [],
	},
	{
		code: `
        const child_process = require('child_process');
      `,
		errors: [{ messageId: "doesNotMatchFormat" }],
		options: [
			{
				filter: {
					match: true,
					regex: "child_process",
				},
				format: ["camelCase"],
				selector: "default",
			},
		],
	},
	{
		code: `
        declare const any_camelCase01: any;
        declare const any_camelCase02: any | null;
        declare const any_camelCase03: any | null | undefined;
        declare const string_camelCase01: string;
        declare const string_camelCase02: string | null;
        declare const string_camelCase03: string | null | undefined;
        declare const string_camelCase04: 'a' | null | undefined;
        declare const string_camelCase05: string | 'a' | null | undefined;
        declare const number_camelCase06: number;
        declare const number_camelCase07: number | null;
        declare const number_camelCase08: number | null | undefined;
        declare const number_camelCase09: 1 | null | undefined;
        declare const number_camelCase10: number | 2 | null | undefined;
        declare const boolean_camelCase11: boolean;
        declare const boolean_camelCase12: boolean | null;
        declare const boolean_camelCase13: boolean | null | undefined;
        declare const boolean_camelCase14: true | null | undefined;
        declare const boolean_camelCase15: false | null | undefined;
        declare const boolean_camelCase16: true | false | null | undefined;
      `,
		errors: Array(19).fill({ messageId: "doesNotMatchFormatTrimmed" }),
		options: [
			{
				format: ["UPPER_CASE"],
				modifiers: ["const"],
				prefix: ["any_"],
				selector: "variable",
			},
			{
				format: ["snake_case"],
				prefix: ["string_"],
				selector: "variable",
				types: ["string"],
			},
			{
				format: ["snake_case"],
				prefix: ["number_"],
				selector: "variable",
				types: ["number"],
			},
			{
				format: ["snake_case"],
				prefix: ["boolean_"],
				selector: "variable",
				types: ["boolean"],
			},
		],
	},
	{
		code: `
        declare const function_camelCase1: () => void;
        declare const function_camelCase2: (() => void) | null;
        declare const function_camelCase3: (() => void) | null | undefined;
        declare const function_camelCase4:
          | (() => void)
          | (() => string)
          | null
          | undefined;
      `,
		errors: Array(4).fill({ messageId: "doesNotMatchFormatTrimmed" }),
		options: [
			{
				format: ["snake_case"],
				prefix: ["function_"],
				selector: "variable",
				types: ["function"],
			},
		],
	},
	{
		code: `
        declare const array_camelCase1: Array<number>;
        declare const array_camelCase2: ReadonlyArray<number> | null;
        declare const array_camelCase3: number[] | null | undefined;
        declare const array_camelCase4: readonly number[] | null | undefined;
        declare const array_camelCase5:
          | number[]
          | (number | string)[]
          | null
          | undefined;
        declare const array_camelCase6: [] | null | undefined;
        declare const array_camelCase7: [number] | null | undefined;
        declare const array_camelCase8:
          | readonly number[]
          | Array<string>
          | [boolean]
          | null
          | undefined;
      `,
		errors: Array(8).fill({ messageId: "doesNotMatchFormatTrimmed" }),
		options: [
			{
				format: ["snake_case"],
				prefix: ["array_"],
				selector: "variable",
				types: ["array"],
			},
		],
	},
	{
		code: `
        let unused_foo = 'a';
        const _unused_foo = 1;
        interface IFoo {}
        class IBar {}
        function fooBar() {}
      `,
		errors: [
			{
				data: {
					name: "unused_foo",
					regex: "/^unused_\\w/u",
					regexMatch: "not match",
					type: "Variable",
				},
				line: 2,
				messageId: "satisfyCustom",
			},
			{
				data: {
					name: "_unused_foo",
					regex: "/^unused_\\w/u",
					regexMatch: "not match",
					type: "Variable",
				},
				line: 3,
				messageId: "satisfyCustom",
			},
			{
				data: {
					name: "IFoo",
					regex: "/^I[A-Z]/u",
					regexMatch: "not match",
					type: "Interface",
				},
				line: 4,
				messageId: "satisfyCustom",
			},
			{
				data: {
					name: "IBar",
					regex: "/^I[A-Z]/u",
					regexMatch: "not match",
					type: "Class",
				},
				line: 5,
				messageId: "satisfyCustom",
			},
			{
				data: {
					name: "fooBar",
					regex: "/function/u",
					regexMatch: "match",
					type: "Function",
				},
				line: 6,
				messageId: "satisfyCustom",
			},
		],
		options: [
			{
				custom: {
					match: false,
					regex: /^unused_\w/.source,
				},
				format: ["snake_case"],
				leadingUnderscore: "allow",
				selector: "default",
			},
			{
				custom: {
					match: false,
					regex: /^I[A-Z]/.source,
				},
				format: ["PascalCase"],
				selector: "typeLike",
			},
			{
				custom: {
					match: true,
					regex: /function/.source,
				},
				format: ["camelCase"],
				leadingUnderscore: "allow",
				selector: "function",
			},
		],
	},
	{
		code: `
        let unused_foo = 'a';
        const _unused_foo = 1;
        function foo_bar() {}
        interface IFoo {}
        class IBar {}
      `,
		errors: [
			{
				data: {
					name: "unused_foo",
					formats: "camelCase",
					type: "Variable",
				},
				line: 2,
				messageId: "doesNotMatchFormat",
			},
			{
				data: {
					name: "_unused_foo",
					formats: "camelCase",
					processedName: "unused_foo",
					type: "Variable",
				},
				line: 3,
				messageId: "doesNotMatchFormatTrimmed",
			},
			{
				data: {
					name: "foo_bar",
					formats: "camelCase",
					type: "Function",
				},
				line: 4,
				messageId: "doesNotMatchFormat",
			},
			{
				data: {
					name: "IFoo",
					regex: "/^I[A-Z]/u",
					regexMatch: "not match",
					type: "Interface",
				},
				line: 5,
				messageId: "satisfyCustom",
			},
			{
				data: {
					name: "IBar",
					regex: "/^I[A-Z]/u",
					regexMatch: "not match",
					type: "Class",
				},
				line: 6,
				messageId: "satisfyCustom",
			},
		],
		options: [
			{
				format: ["camelCase"],
				leadingUnderscore: "allow",
				selector: ["variable", "function"],
			},
			{
				custom: {
					match: false,
					regex: /^I[A-Z]/.source,
				},
				format: ["PascalCase"],
				selector: ["class", "interface"],
			},
		],
	},
	{
		code: `
        const foo = {
          'Property Name': 'asdf',
        };
      `,
		errors: [
			{
				data: {
					name: "Property Name",
					formats: "strictCamelCase",
					type: "Object Literal Property",
				},
				line: 3,
				messageId: "doesNotMatchFormat",
			},
		],
		options: [
			{
				filter: {
					match: false,
					regex: /-/.source,
				},
				format: ["strictCamelCase"],
				selector: "default",
			},
		],
	},
	{
		code: `
        const myfoo_bar = 'abcs';
        function fun(myfoo: string) {}
        class foo {
          Myfoo: string;
        }
      `,
		errors: Array(3).fill({ messageId: "doesNotMatchFormatTrimmed" }),
		options: [
			{
				format: ["PascalCase"],
				prefix: ["my", "My"],
				selector: ["variable", "property", "parameter"],
				types: ["string"],
			},
		],
	},
	{
		code: `
        class foo {
          private readonly fooBar: boolean;
        }
      `,
		errors: [{ messageId: "doesNotMatchFormat" }],
		options: [
			{
				format: ["PascalCase"],
				modifiers: ["private", "readonly"],
				selector: ["property", "accessor"],
			},
		],
	},
	{
		// `types` is honored on function selectors (fork divergence from
		// upstream, where it is silently ignored); the "function" modifier
		// matches the declaration's own callable type
		code: `
        function my_foo_bar() {}
      `,
		errors: [{ messageId: "doesNotMatchFormatTrimmed" }],
		options: [
			{
				format: ["PascalCase"],
				prefix: ["my", "My"],
				selector: ["variable", "function"],
				types: ["function"],
			},
		],
	},
	{
		code: `
        class SomeClass {
          static otherConstant = 'hello';
        }

        export const { otherConstant } = SomeClass;
      `,
		errors: [
			{
				line: 3,
				messageId: "doesNotMatchFormat",
			},
		],
		options: [
			{ format: ["PascalCase"], selector: "property" },
			{ format: ["camelCase"], selector: "variable" },
		],
	},
	{
		code: `
        declare class Foo {
          Bar(Baz: string): void;
        }
      `,
		errors: [
			{
				line: 3,
				messageId: "doesNotMatchFormat",
			},
		],
		options: [{ format: ["camelCase"], selector: "parameter" }],
	},
	{
		code: `
        export const PascalCaseVar = 1;
        export enum PascalCaseEnum {}
        export class PascalCaseClass {}
        export function PascalCaseFunction() {}
        export interface PascalCaseInterface {}
        export type PascalCaseType = {};
      `,
		errors: Array(6).fill({ messageId: "doesNotMatchFormat" }),
		options: [
			{
				format: ["snake_case"],
				selector: "default",
			},
			{
				format: ["camelCase"],
				modifiers: ["exported"],
				selector: "variable",
			},
			{
				format: ["camelCase"],
				modifiers: ["exported"],
				selector: "function",
			},
			{
				format: ["camelCase"],
				modifiers: ["exported"],
				selector: "class",
			},
			{
				format: ["camelCase"],
				modifiers: ["exported"],
				selector: "interface",
			},
			{
				format: ["camelCase"],
				modifiers: ["exported"],
				selector: "typeAlias",
			},
			{
				format: ["camelCase"],
				modifiers: ["exported"],
				selector: "enum",
			},
		],
	},
	{
		code: `
        const PascalCaseVar = 1;
        enum PascalCaseEnum {}
        class PascalCaseClass {}
        function PascalCaseFunction() {}
        interface PascalCaseInterface {}
        type PascalCaseType = {};
        export {
          PascalCaseVar,
          PascalCaseEnum,
          PascalCaseClass,
          PascalCaseFunction,
          PascalCaseInterface,
          PascalCaseType,
        };
      `,
		errors: Array(6).fill({ messageId: "doesNotMatchFormat" }),
		options: [
			{ format: ["snake_case"], selector: "default" },
			{
				format: ["camelCase"],
				modifiers: ["exported"],
				selector: "variable",
			},
			{
				format: ["camelCase"],
				modifiers: ["exported"],
				selector: "function",
			},
			{
				format: ["camelCase"],
				modifiers: ["exported"],
				selector: "class",
			},
			{
				format: ["camelCase"],
				modifiers: ["exported"],
				selector: "interface",
			},
			{
				format: ["camelCase"],
				modifiers: ["exported"],
				selector: "typeAlias",
			},
			{
				format: ["camelCase"],
				modifiers: ["exported"],
				selector: "enum",
			},
		],
	},
	{
		code: `
        const PascalCaseVar = 1;
        function PascalCaseFunction() {}
        declare function PascalCaseDeclaredFunction();
      `,
		errors: Array(3).fill({ messageId: "doesNotMatchFormat" }),
		options: [
			{ format: ["snake_case"], selector: "default" },
			{
				format: ["camelCase"],
				modifiers: ["global"],
				selector: "variable",
			},
			{
				format: ["camelCase"],
				modifiers: ["global"],
				selector: "function",
			},
		],
	},
	{
		code: `
        const { some_name1 } = {};
        const { some_name2 = 2 } = {};
        const { ignored: IgnoredDueToModifiers1 } = {};
        const { ignored: IgnoredDueToModifiers2 = 3 } = {};
        const IgnoredDueToModifiers3 = 1;
      `,
		errors: Array(2).fill({ messageId: "doesNotMatchFormat" }),
		options: [
			{
				format: ["PascalCase"],
				selector: "default",
			},
			{
				format: ["UPPER_CASE"],
				modifiers: ["destructured"],
				selector: "variable",
			},
		],
	},
	{
		code: `
        export function Foo(
          { aName },
          { anotherName = 1 },
          { ignored: IgnoredDueToModifiers1 },
          { ignored: IgnoredDueToModifiers1 = 2 },
          IgnoredDueToModifiers2,
        ) {}
      `,
		errors: Array(2).fill({ messageId: "doesNotMatchFormat" }),
		options: [
			{
				format: ["PascalCase"],
				selector: "default",
			},
			{
				format: ["UPPER_CASE"],
				modifiers: ["destructured"],
				selector: "parameter",
			},
		],
	},
	{
		code: `
        class Ignored {
          private static abstract readonly some_name;
          IgnoredDueToModifiers = 1;
        }
      `,
		errors: [{ messageId: "doesNotMatchFormat" }],
		options: [
			{
				format: ["PascalCase"],
				selector: "default",
			},
			{
				format: ["UPPER_CASE"],
				modifiers: ["static", "readonly"],
				selector: "classProperty",
			},
		],
	},
	{
		code: `
        class Ignored {
          constructor(
            private readonly some_name,
            IgnoredDueToModifiers,
          ) {}
        }
      `,
		errors: [{ messageId: "doesNotMatchFormat" }],
		options: [
			{
				format: ["PascalCase"],
				selector: "default",
			},
			{
				format: ["UPPER_CASE"],
				modifiers: ["readonly"],
				selector: "parameterProperty",
			},
		],
	},
	{
		code: `
        class Ignored {
          private static abstract some_name();
          IgnoredDueToModifiers() {}
        }
      `,
		errors: [{ messageId: "doesNotMatchFormat" }],
		options: [
			{
				format: ["PascalCase"],
				selector: "default",
			},
			{
				format: ["UPPER_CASE"],
				modifiers: ["abstract", "static"],
				selector: "classMethod",
			},
		],
	},
	{
		code: `
        class Ignored {
          private static get some_name() {}
          get IgnoredDueToModifiers() {}
        }
      `,
		errors: [{ messageId: "doesNotMatchFormat" }],
		options: [
			{
				format: ["PascalCase"],
				selector: "default",
			},
			{
				format: ["UPPER_CASE"],
				modifiers: ["private", "static"],
				selector: "accessor",
			},
		],
	},
	{
		code: `
        abstract class some_name {}
        class IgnoredDueToModifier {}
      `,
		errors: [{ messageId: "doesNotMatchFormat" }],
		options: [
			{
				format: ["PascalCase"],
				selector: "default",
			},
			{
				format: ["UPPER_CASE"],
				modifiers: ["abstract"],
				selector: "class",
			},
		],
	},
	{
		code: `
        const UnusedVar = 1;
        function UnusedFunc(
          // this line is intentionally broken out
          UnusedParam: string,
        ) {}
        class UnusedClass {}
        interface UnusedInterface {}
        type UnusedType<
          // this line is intentionally broken out
          UnusedTypeParam,
        > = {};
      `,
		errors: Array(7).fill({ messageId: "doesNotMatchFormat" }),
		options: [
			{
				format: ["PascalCase"],
				selector: "default",
			},
			{
				format: ["snake_case"],
				modifiers: ["unused"],
				selector: "default",
			},
		],
	},
	{
		code: `
        const ignored1 = {
          'a a': 1,
          'b b'() {},
          get 'c c'() {
            return 1;
          },
          set 'd d'(value: string) {},
        };
        class ignored2 {
          'a a' = 1;
          'b b'() {}
          get 'c c'() {
            return 1;
          }
          set 'd d'(value: string) {}
        }
        interface ignored3 {
          'a a': 1;
          'b b'(): void;
        }
        type ignored4 = {
          'a a': 1;
          'b b'(): void;
        };
        enum ignored5 {
          'a a',
        }
      `,
		errors: Array(13).fill({ messageId: "doesNotMatchFormat" }),
		options: [
			{
				format: ["snake_case"],
				selector: "default",
			},
			{
				format: ["PascalCase"],
				modifiers: ["requiresQuotes"],
				selector: "default",
			},
		],
	},
	{
		code: unindent`
        type Foo = {
          'foo     Bar': string;
          '': string;
          '0': string;
          'foo': string;
          'foo-bar': string;
          '#foo-bar': string;
        };

        interface Bar {
          'boo-----foo': string;
        }
      `,
		// 6, not 7 because 'foo' is valid
		errors: Array(6).fill({ messageId: "doesNotMatchFormat" }),
	},
	{
		code: `
        class foo {
          public Bar() {
            return 42;
          }
          public async async_bar() {
            return 42;
          }
          // ❌ error
          public async asyncBar() {
            return 42;
          }
          // ❌ error
          public AsyncBar2 = async () => {
            return 42;
          };
          // ❌ error
          public AsyncBar3 = async function () {
            return 42;
          };
        }
        abstract class foo {
          public abstract Bar(): number;
          public abstract async async_bar(): number;
          // ❌ error
          public abstract async ASYNC_BAR(): number;
        }
      `,
		errors: [
			{
				data: {
					name: "asyncBar",
					formats: "snake_case",
					type: "Class Method",
				},
				messageId: "doesNotMatchFormat",
			},
			{
				data: {
					name: "AsyncBar2",
					formats: "snake_case",
					type: "Class Method",
				},
				messageId: "doesNotMatchFormat",
			},
			{
				data: {
					name: "AsyncBar3",
					formats: "snake_case",
					type: "Class Method",
				},
				messageId: "doesNotMatchFormat",
			},
			{
				data: {
					name: "ASYNC_BAR",
					formats: "snake_case",
					type: "Class Method",
				},
				messageId: "doesNotMatchFormat",
			},
		],
		options: [
			{
				format: ["camelCase"],
				selector: "memberLike",
			},
			{
				format: ["PascalCase"],
				selector: "method",
			},
			{
				format: ["snake_case"],
				modifiers: ["async"],
				selector: ["method", "objectLiteralMethod"],
			},
		],
	},
	{
		code: `
        const obj = {
          Bar() {
            return 42;
          },
          async async_bar() {
            return 42;
          },
          // ❌ error
          async AsyncBar() {
            return 42;
          },
          // ❌ error
          AsyncBar2: async () => {
            return 42;
          },
          // ❌ error
          AsyncBar3: async function () {
            return 42;
          },
        };
      `,
		errors: [
			{
				data: {
					name: "AsyncBar",
					formats: "snake_case",
					type: "Object Literal Method",
				},
				messageId: "doesNotMatchFormat",
			},
			{
				data: {
					name: "AsyncBar2",
					formats: "snake_case",
					type: "Object Literal Method",
				},
				messageId: "doesNotMatchFormat",
			},
			{
				data: {
					name: "AsyncBar3",
					formats: "snake_case",
					type: "Object Literal Method",
				},
				messageId: "doesNotMatchFormat",
			},
		],
		options: [
			{
				format: ["camelCase"],
				selector: "memberLike",
			},
			{
				format: ["PascalCase"],
				selector: "method",
			},
			{
				format: ["snake_case"],
				modifiers: ["async"],
				selector: ["method", "objectLiteralMethod"],
			},
		],
	},
	{
		code: `
        const syncbar1 = () => {};
        function syncBar2() {}
        const syncBar3 = function syncBar4() {};

        // ❌ error
        const AsyncBar1 = async () => {};
        const async_bar1 = async () => {};
        const async_bar3 = async function async_bar4() {};
        async function async_bar2() {}
        // ❌ error
        const asyncBar5 = async function async_bar6() {};
      `,
		errors: [
			{
				data: {
					name: "AsyncBar1",
					formats: "snake_case",
					type: "Variable",
				},
				messageId: "doesNotMatchFormat",
			},
			{
				data: {
					name: "asyncBar5",
					formats: "snake_case",
					type: "Variable",
				},
				messageId: "doesNotMatchFormat",
			},
		],
		options: [
			{
				format: ["camelCase"],
				selector: "variableLike",
			},
			{
				format: ["snake_case"],
				modifiers: ["async"],
				selector: ["variableLike"],
			},
		],
	},
	{
		code: `
        const syncbar1 = () => {};
        function syncBar2() {}
        const syncBar3 = function syncBar4() {};

        const async_bar1 = async () => {};
        // ❌ error
        async function asyncBar2() {}
        const async_bar3 = async function async_bar4() {};
        async function async_bar2() {}
        // ❌ error
        const async_bar3 = async function ASYNC_BAR4() {};
      `,
		errors: [
			{
				data: {
					name: "asyncBar2",
					formats: "snake_case",
					type: "Function",
				},
				messageId: "doesNotMatchFormat",
			},
			{
				data: {
					name: "ASYNC_BAR4",
					formats: "snake_case",
					type: "Function",
				},
				messageId: "doesNotMatchFormat",
			},
		],
		options: [
			{
				format: ["camelCase"],
				selector: "variableLike",
			},
			{
				format: ["snake_case"],
				modifiers: ["async"],
				selector: ["variableLike"],
			},
		],
	},
	{
		code: `
        class foo extends bar {
          public someAttribute = 1;
          public override some_attribute_override = 1;
          // ❌ error
          public override someAttributeOverride = 1;
        }
      `,
		errors: [
			{
				data: {
					name: "someAttributeOverride",
					formats: "snake_case",
					type: "Class Property",
				},
				messageId: "doesNotMatchFormat",
			},
		],
		options: [
			{
				format: ["camelCase"],
				selector: "memberLike",
			},
			{
				format: ["snake_case"],
				modifiers: ["override"],
				selector: ["memberLike"],
			},
		],
	},
	{
		code: `
        class foo extends bar {
          public override some_method_override() {
            return 42;
          }
          // ❌ error
          public override someMethodOverride() {
            return 42;
          }
        }
      `,
		errors: [
			{
				data: {
					name: "someMethodOverride",
					formats: "snake_case",
					type: "Class Method",
				},
				messageId: "doesNotMatchFormat",
			},
		],
		options: [
			{
				format: ["camelCase"],
				selector: "memberLike",
			},
			{
				format: ["snake_case"],
				modifiers: ["override"],
				selector: ["memberLike"],
			},
		],
	},
	{
		code: `
        class foo extends bar {
          public get someGetter(): string;
          public override get some_getter_override(): string;
          // ❌ error
          public override get someGetterOverride(): string;
          public set someSetter(val: string);
          public override set some_setter_override(val: string);
          // ❌ error
          public override set someSetterOverride(val: string);
        }
      `,
		errors: [
			{
				data: {
					name: "someGetterOverride",
					formats: "snake_case",
					type: "Classic Accessor",
				},
				messageId: "doesNotMatchFormat",
			},
			{
				data: {
					name: "someSetterOverride",
					formats: "snake_case",
					type: "Classic Accessor",
				},
				messageId: "doesNotMatchFormat",
			},
		],
		options: [
			{
				format: ["camelCase"],
				selector: "memberLike",
			},
			{
				format: ["snake_case"],
				modifiers: ["override"],
				selector: ["memberLike"],
			},
		],
	},
	{
		code: `
        class foo {
          private firstPrivateField = 1;
          // ❌ error
          private first_private_field = 1;
          // ❌ error
          #secondPrivateField = 1;
          #second_private_field = 1;
        }
      `,
		errors: [
			{
				data: {
					name: "first_private_field",
					formats: "camelCase",
					type: "Class Property",
				},
				messageId: "doesNotMatchFormat",
			},
			{
				data: {
					name: "secondPrivateField",
					formats: "snake_case",
					type: "Class Property",
				},
				messageId: "doesNotMatchFormat",
			},
		],
		options: [
			{
				format: ["camelCase"],
				selector: "memberLike",
			},
			{
				format: ["snake_case"],
				modifiers: ["#private"],
				selector: ["memberLike"],
			},
		],
	},
	{
		code: `
        class foo {
          private firstPrivateMethod() {}
          // ❌ error
          private first_private_method() {}
          // ❌ error
          #secondPrivateMethod() {}
          #second_private_method() {}
        }
      `,
		errors: [
			{
				data: {
					name: "first_private_method",
					formats: "camelCase",
					type: "Class Method",
				},
				messageId: "doesNotMatchFormat",
			},
			{
				data: {
					name: "secondPrivateMethod",
					formats: "snake_case",
					type: "Class Method",
				},
				messageId: "doesNotMatchFormat",
			},
		],
		options: [
			{
				format: ["camelCase"],
				selector: "memberLike",
			},
			{
				format: ["snake_case"],
				modifiers: ["#private"],
				selector: ["memberLike"],
			},
		],
	},
	{
		code: "import * as fooBar from 'foo_bar';",
		errors: [
			{
				data: {
					name: "fooBar",
					formats: "PascalCase",
					type: "Import",
				},
				messageId: "doesNotMatchFormat",
			},
		],
		options: [
			{
				format: ["camelCase"],
				selector: ["import"],
			},
			{
				format: ["PascalCase"],
				modifiers: ["namespace"],
				selector: ["import"],
			},
		],
	},
	{
		code: "import FooBar from 'foo_bar';",
		errors: [
			{
				data: {
					name: "FooBar",
					formats: "camelCase",
					type: "Import",
				},
				messageId: "doesNotMatchFormat",
			},
		],
		options: [
			{
				format: ["camelCase"],
				selector: ["import"],
			},
			{
				format: ["PascalCase"],
				modifiers: ["namespace"],
				selector: ["import"],
			},
		],
	},
	{
		code: "import { default as foo_bar } from 'foo_bar';",
		errors: [
			{
				data: {
					name: "foo_bar",
					formats: "camelCase",
					type: "Import",
				},
				messageId: "doesNotMatchFormat",
			},
		],
		options: [
			{
				format: ["camelCase"],
				selector: ["import"],
			},
			{
				format: ["PascalCase"],
				modifiers: ["namespace"],
				selector: ["import"],
			},
		],
	},
	{
		code: "import { \"🍎\" as foo } from 'foo_bar';",
		errors: [
			{
				data: {
					name: "foo",
					formats: "PascalCase",
					type: "Import",
				},
				messageId: "doesNotMatchFormat",
			},
		],
		options: [
			{
				format: ["PascalCase"],
				selector: ["import"],
			},
		],
	},
	{
		code: `
        const colors = { RED: 'red', BLUE: 'blue' } as const;
        const statusCodes = { OK: 200, NOT_FOUND: 404 } as const;
      `,
		errors: [
			{
				data: {
					name: "colors",
					formats: "UPPER_CASE",
					type: "Object Style Enum",
				},
				messageId: "doesNotMatchFormatForeignContract",
			},
			{
				data: {
					name: "statusCodes",
					formats: "UPPER_CASE",
					type: "Object Style Enum",
				},
				messageId: "doesNotMatchFormatForeignContract",
			},
		],
		options: [
			{
				format: ["UPPER_CASE"],
				selector: "objectStyleEnum",
			},
		],
	},
	{
		code: `
        const colors = { RED: 'red', BLUE: 'blue' } as const;
      `,
		errors: [
			{
				data: {
					name: "colors",
					formats: "UPPER_CASE",
					type: "Object Style Enum",
				},
				messageId: "doesNotMatchFormatForeignContract",
			},
		],
		options: [
			{
				format: ["UPPER_CASE"],
				selector: "objectStyleEnum",
			},
		],
	},
	// Regular class methods should still fail naming validation
	{
		code: `
        class RegularClass {
          public ProcessData(data: string): string {
            return data;
          }

          private FormatMessage(msg: string): string {
            return msg.toLowerCase();
          }
        }
      `,
		errors: [
			{
				messageId: "doesNotMatchFormat",
			},
			{
				messageId: "doesNotMatchFormat",
			},
		],
		options: [
			{
				format: ["strictCamelCase"],
				selector: ["function", "classMethod"],
			},
		],
	},
	// Class implementing interface - only non-interface methods should fail
	{
		code: `
        interface IProcessor {
          ProcessData(data: string): string;
        }

        class DataProcessor implements IProcessor {
          public ProcessData(data: string): string {
            return this.FormatData(data);
          }

          // This method is NOT from interface - should fail
          private FormatData(data: string): string {
            return data.toLowerCase();
          }
        }
      `,
		errors: [
			{
				messageId: "doesNotMatchFormat",
			},
		],
		options: [
			{
				format: ["strictCamelCase"],
				selector: ["function", "classMethod"],
			},
		],
	},
	{
		// type reference (loose name-only) - PascalCase enforced; camelCase
		// rejected
		code: "type Entity<TData = unknown> = number & { readonly __type: TData }; declare function component<T = unknown>(): Entity<T>; const myComponent = component();",
		errors: [{ messageId: "doesNotMatchFormat" }],
		options: [
			{
				format: ["PascalCase"],
				modifiers: ["const"],
				selector: "variable",
				types: [{ name: "Entity" }],
			},
		],
	},
	{
		// type reference - snake_case rejected on Pair-typed const
		code: "type Pair<P = unknown, O = unknown> = { readonly __pred: P; readonly __obj: O }; declare function pair<P, O>(p: P, o: O): Pair<P, O>; const my_pair = pair(1, 2);",
		errors: [{ messageId: "doesNotMatchFormat" }],
		options: [
			{
				format: ["PascalCase"],
				modifiers: ["const"],
				selector: "variable",
				types: [{ name: "Pair" }],
			},
		],
	},
	{
		// type reference - any-cast must bypass the match and fall back to the
		// default rule
		code: "const NotEntity = 42 as any;",
		errors: [{ messageId: "doesNotMatchFormat" }],
		options: [
			{
				format: ["PascalCase"],
				modifiers: ["const"],
				selector: "variable",
				types: [{ name: "Entity" }],
			},
			{ format: ["camelCase"], selector: "variable" },
		],
	},
	{
		// type reference - union of two referenced types with snake_case
		// rejected under PascalCase
		code: "type Entity<TData = unknown> = { readonly __type: TData }; type Pair<P = unknown, O = unknown> = { readonly __pred: P; readonly __obj: O }; type Id<T = unknown> = Entity<T> | Pair<T, unknown>; declare function resolveId<T>(): Id<T>; const resolved_id = resolveId();",
		errors: [{ messageId: "doesNotMatchFormat" }],
		options: [
			{
				format: ["PascalCase"],
				modifiers: ["const"],
				selector: "variable",
				types: [{ name: "Entity" }, { name: "Pair" }],
			},
		],
	},
	{
		// type reference - `from` mismatch falls back to default rule
		// (declaration not in expected module)
		code: "type LocalEntity = { readonly __local: true }; declare function component(): LocalEntity; const MyComponent = component();",
		errors: [{ messageId: "doesNotMatchFormat" }],
		options: [
			{
				format: ["PascalCase"],
				modifiers: ["const"],
				selector: "variable",
				types: [{ name: "LocalEntity", from: "some-other-pkg" }],
			},
			{ format: ["camelCase"], selector: "variable" },
		],
	},
	{
		// returns matcher - camelCase rejected once the return type matches
		code: "type Node = { readonly __node: true }; declare function createProbe(): () => Node; const myProbe = createProbe();",
		errors: [{ messageId: "doesNotMatchFormat" }],
		options: [
			{
				format: ["PascalCase"],
				modifiers: ["const"],
				selector: "variable",
				types: [{ returns: { name: "Node" } }],
			},
		],
	},
	{
		// returns matcher - return type mismatch falls back to the default rule;
		// PascalCase then rejected by the camelCase fallback
		code: "declare function makeThing(): () => number; const MyThing = makeThing();",
		errors: [{ messageId: "doesNotMatchFormat" }],
		options: [
			{
				format: ["PascalCase"],
				modifiers: ["const"],
				selector: "variable",
				types: [{ returns: { name: "Node" } }],
			},
			{ format: ["camelCase"], selector: "variable" },
		],
	},
	{
		// returns matcher on typeMethod - non-matching method still held to the
		// base camelCase format
		code: "type Node = { readonly __node: true }; interface Api { GetCount(): number; }",
		errors: [{ messageId: "doesNotMatchFormat" }],
		options: [
			{
				format: ["PascalCase"],
				selector: "typeMethod",
				types: [{ returns: { name: "Node" } }],
			},
			{ format: ["camelCase"], selector: "typeMethod" },
		],
	},
	{
		// contextual type - no contextual type means the name is the author's
		// choice; property still validated
		code: "const x = { PascalProp: 1 };",
		errors: [{ messageId: "doesNotMatchFormat" }],
		options: dictatedNameOptions,
	},
	{
		// contextual type - no contextual type, method
		code: "const x = { GetThing() { return 1; } };",
		errors: [{ messageId: "doesNotMatchFormat" }],
		options: dictatedNameOptions,
	},
	{
		// contextual type - a string index signature does not dictate the
		// specific name
		code: "const x: Record<string, number> = { PascalProp: 1 };",
		errors: [{ messageId: "doesNotMatchFormat" }],
		options: dictatedNameOptions,
	},
	{
		// contextual type - per-property granularity: declared member skipped,
		// index-signature-only member still validated
		code: "interface Config { Declared: number; [key: string]: number } const x = { Declared: 1, NotDeclared: 2 } satisfies Config;",
		errors: [
			{
				data: {
					name: "NotDeclared",
					formats: "camelCase",
					type: "Object Literal Property",
				},
				messageId: "doesNotMatchFormat",
			},
		],
		options: dictatedNameOptions,
	},
	{
		// contextual type - generic self-inference guard: `T` is inferred from
		// the literal itself, so the name is still the author's choice
		code: "declare function identity<T>(x: T): T; identity({ PascalProp: 1 });",
		errors: [{ messageId: "doesNotMatchFormat" }],
		options: dictatedNameOptions,
	},
	{
		// contextual type - `as const` provides no contextual type. The key is
		// also a top-level objectStyleEnum member, so it's validated as an
		// enumMember (not an objectLiteralProperty) and gets the ForeignContract
		// message variant
		code: "const x = { PascalProp: 1 } as const;",
		errors: [{ messageId: "doesNotMatchFormatForeignContract" }],
		options: [...dictatedNameOptions, { format: ["camelCase"], selector: "enumMember" }],
	},
	{
		// contextual type - contextual type without the property
		code: "const x: object = { PascalProp: 1 };",
		errors: [{ messageId: "doesNotMatchFormat" }],
		options: dictatedNameOptions,
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: namingConvention,
	valid,
});

// `from` positive matches (bare package + relative path) need a project whose
// module resolution can reach a real `/node_modules/<pkg>/` directory, so they
// run against the dedicated fixture at `fixtures/naming-convention/from-match`.
const fromMatchDirectory = path.resolve(
	__dirname,
	"../../../fixtures/naming-convention/from-match",
);
const fromMatchCase = path.join(fromMatchDirectory, "case.ts");

run({
	name: `${RULE_NAME}/from-match`,
	invalid: [
		{
			// camelCase const typed via `fake-pkg` Entity rejected under
			// PascalCase — proves the bare-package `from` substring against
			// `/node_modules/fake-pkg/` is active
			code: 'import { component } from "fake-pkg"; const myComponent = component();',
			errors: [{ messageId: "doesNotMatchFormat" }],
			filename: fromMatchCase,
			options: [
				{
					format: ["PascalCase"],
					modifiers: ["const"],
					selector: "variable",
					types: [{ name: "Entity", from: "fake-pkg" }],
				},
			],
		},
	],
	parserOptions: {
		ecmaVersion: "latest",
		project: path.join(fromMatchDirectory, "tsconfig.json"),
		sourceType: "module",
		tsconfigRootDir: fromMatchDirectory,
	},
	rule: namingConvention,
	valid: [
		{
			// `from` (bare package): PascalCase const typed via `fake-pkg`
			// Entity passes
			code: 'import { component } from "fake-pkg"; const Health = component();',
			filename: fromMatchCase,
			options: [
				{
					format: ["PascalCase"],
					modifiers: ["const"],
					selector: "variable",
					types: [{ name: "Entity", from: "fake-pkg" }],
				},
			],
		},
		{
			// `from` (relative path-form): PascalCase const typed via a
			// project-local type passes
			code: 'import { makeLocal } from "./src/shared/local-thing"; const LocalValue = makeLocal();',
			filename: fromMatchCase,
			options: [
				{
					format: ["PascalCase"],
					modifiers: ["const"],
					selector: "variable",
					types: [{ name: "LocalThing", from: "./src/shared/local-thing" }],
				},
			],
		},
		{
			// `from` mismatch (right name, wrong module): falls back to the
			// second clause; camelCase allowed
			code: 'import { component } from "fake-pkg"; const myComponent = component();',
			filename: fromMatchCase,
			options: [
				{
					format: ["PascalCase"],
					modifiers: ["const"],
					selector: "variable",
					types: [{ name: "Entity", from: "some-other-pkg" }],
				},
				{ format: ["camelCase"], selector: "variable" },
			],
		},
	],
});

// ruleTester.run('naming-convention', rule, {
//   invalid: [

//   valid: [

// });
