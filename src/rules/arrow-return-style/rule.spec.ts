import tsParser from "@typescript-eslint/parser";

import { Linter } from "eslint";
import { type InvalidTestCase, unindent, type ValidTestCase } from "eslint-vitest-rule-tester";
import { beforeAll, describe, expect, it } from "vitest";

import { run } from "../test";
import { arrowReturnStyle, type Options, RULE_NAME } from "./rule";

// TDD target for the port of `arrow-return-style` from
// eslint-plugin-arrow-return-style-x. Decided semantics (differences from the
// old rule are deliberate — do not "fix" a case to match old behavior):
//
// 1. `maxLen` applies to the FULL post-fix line the fixer would emit:
//    indentation + declaration prefix + arrow + body + trailing punctuation.
//    Never the isolated arrow at column 0 (the old prefix-blind measurement
//    caused 150+ confirmed infinite rule<->formatter fix loops).
// 2. Formatting truth comes from oxfmt (prettier-conformant), consulted via a
//    synckit worker only for boundary decisions. Option: `useOxfmt` (boolean or
//    `{ printWidth?: number }`), replacing the old `usePrettier`. A verdict must
//    be identical with the formatter on or off whenever the emitted line is
//    clearly under/over `maxLen`.
// 3. Multiline OBJECT bodies prefer the explicit block form: a multiline
//    implicit object converts to an explicit block (with the explicit
//    messageId — the old rule reported "use implicit" for this, which was
//    backwards), and an explicit block containing a multiline literal is left
//    alone. Multiline ARRAY bodies are formatter-owned and never touched:
//    oxfmt freely collapses/expands arrays (no `objectWrap: "preserve"`
//    protection), so converting them provably ping-pongs against the
//    formatter (caught by the fixpoint suite). The rule never collapses a
//    multiline literal to one line either (the old regex collapse corrupted
//    string contents); single-line collapse is the formatter's job.
// 4. Fixes are source-faithful (quotes/spacing preserved); the fixpoint suite
//    below guarantees outputs re-lint clean both raw and after oxfmt.
// 5. Tabs expand to `tabWidth` columns (default 4) when measuring against
//    `maxLen`, mirroring how the formatter counts printWidth. No case in this
//    suite flips verdict between tabWidth 1-4.
// 6. Explicit-return fixes always terminate the emitted `return` statement
//    with `;` (the old rule inconsistently omitted it on the comment path).

const implicitMessageId = "useImplicitReturn";
const explicitMessageId = "useExplicitReturn";
const complexExplicitMessageId = "useExplicitReturnComplex";

const complexExplicitOption = "complex-explicit";
const jsxFilename = "file.tsx";

const valid: Array<ValidTestCase> = [
	// --- Carried over from the old suite (verified correct) ---

	"const t = () => Date.now()",
	// Bare `return` has nothing to collapse.
	"const fn = () => { return }",
	"Array.from({ length: 10 }).map((_, i) => i + 1)",

	{
		code: "const Div = () => <><div /></>",
		filename: jsxFilename,
		options: [{ jsxAlwaysUseExplicitReturn: false }],
	},

	// Comments inside the block: the rule bails rather than moving them.
	unindent`
		const bar = () => {
			// line comment
			return 'bar'
		}
	`,

	// Multi-statement bodies are never collapsible.
	unindent`
		const fn = async () => {
			await delay(300)
			return 'fn'
		}
	`,

	// Named exports prefer explicit returns by default.
	unindent`
		export const getUser = async () => {
			return { name: 'admin' }
		}
	`,
	{
		code: "export const getUser = async () => ({ name: 'admin' })",
		options: [{ namedExportsAlwaysUseExplicitReturn: false }],
	},

	// Implicit form would be 93 chars > 80: stays explicit.
	unindent`
		const isMaxLen = (node = arrowRoot) => {
			return node.loc.end.column - node.loc.start.column >= maxLen;
		};
	`,

	// Multiline parameter list: the emitted implicit line would exceed maxLen.
	unindent`
		const isVariableDeclaration = (
			node: TSESTree.Node | null | undefined,
		): node is TSESTree.VariableDeclaration => {
			return node?.type === AST_NODE_TYPES.VariableDeclaration;
		};
	`,

	unindent`
		const obj = {
			temporary: (v: UDim, rem = 0) => new UDim(v.Scale, v.Offset * rem),
		};
	`,

	// Unicode: short strings stay implicit.
	"const 测试函数 = () => '短字符串'",
	"const emojiFunc = () => '🚀'",
	// Boundary: exactly maxLen (80) does NOT trigger; only `> maxLen` does.
	"const exactly80chars = () => 'this string makes the line exactly eighty chars:)'",

	// objectReturnStyle matrix (simple objects/arrays stay implicit).
	{
		code: "const simpleObj = () => ({ player })",
		options: [{ objectReturnStyle: "off" }],
	},
	{
		code: "const simpleObj2 = () => ({ player })",
		options: [{ objectReturnStyle: complexExplicitOption }],
	},
	{
		code: "const twoProps = () => ({ player, id })",
		options: [{ maxObjectProperties: 2, objectReturnStyle: complexExplicitOption }],
	},
	{
		code: "const literalValues = () => ({ name: 'test', id: 1 })",
		options: [{ objectReturnStyle: complexExplicitOption }],
	},
	{
		code: "const simpleArray = () => ([1, 2, 3])",
		options: [{ objectReturnStyle: complexExplicitOption }],
	},
	{
		code: "const identifierArray = () => ([a, b, c])",
		options: [{ objectReturnStyle: complexExplicitOption }],
	},
	{
		code: "const manyElements = () => ([1, 2, 3, 4, 5, 6, 7])",
		options: [{ maxObjectProperties: 2, objectReturnStyle: complexExplicitOption }],
	},
	{
		code: "const singleSpread = () => ({ ...state })",
		options: [{ objectReturnStyle: complexExplicitOption }],
	},
	{
		code: "const singleComputedKey = () => ({ [key]: value })",
		options: [{ objectReturnStyle: complexExplicitOption }],
	},
	{
		code: "const singleFunctionCall = () => ({ name: getValue() })",
		options: [{ objectReturnStyle: complexExplicitOption }],
	},

	{
		code: "Promise.try(() => BadgeService.UserHasBadgeAsync(player.UserId, tonumber(badge)));",
		options: [{ maxLen: 100, useOxfmt: { printWidth: 100 } }],
	},

	// Arrows in expression positions.
	{ code: "const handlers = [() => 'handler']", options: [{ useOxfmt: true }] },
	{ code: "export default () => 'hello'", options: [{ useOxfmt: true }] },
	{ code: "const fn = flag ? () => 'a' : () => 'b'", options: [{ useOxfmt: true }] },

	// Implicit single line would be 108 chars > 100: stays explicit.
	{
		code: unindent`
			await import("@antfu/install-pkg").then((index) => {
				return index.installPackage(nonExistingPackages, { dev: true });
			});
		`,
		options: [{ maxLen: 100, useOxfmt: { printWidth: 100 } }],
	},

	// Method chain: implicit join would be 100 chars > 80.
	{
		code: unindent`
			someVeryLongFunctionName().anotherChainedMethod().finalMethod((param) => {
				return complexCalculation(param);
			});
		`,
		options: [{ maxLen: 80, useOxfmt: { printWidth: 80 } }],
	},

	// Large mixed pipeline stays as-is.
	{
		code: unindent`
			const versions = Object.fromEntries(
				Array.from(names)
					.map((name) => {
						const version = catalogs.map((catalog) => catalog[name]).find(Boolean);
						if (version === undefined) {
							throw new Error(\`Package \${name} not found\`);
						}
						return [name, version] as const;
					})
					.sort((a, b) => a[0].localeCompare(b[0])),
			);
		`,
		options: [{ maxLen: 100, useOxfmt: true }],
	},
	{
		code: "items.sort((a, b) => a.name.localeCompare(b.name))",
		options: [{ maxLen: 100, useOxfmt: true }],
	},
	{
		code: "numbers.filter(n => n > 0).map(n => n * 2).sort((a, b) => a - b)",
		options: [{ maxLen: 100, useOxfmt: true }],
	},

	// Implicit join would be 85 chars > 80: stays explicit.
	{
		code: unindent`
			await playerStore.update(playerId, (data) => {
				return { ...data, coins: data.coins + 100 };
			});
		`,
		options: [{ maxLen: 80, useOxfmt: { printWidth: 80 } }],
	},

	// --- Re-specced: old suite got these wrong ---

	// Old suite forced this to explicit (old spec ~L717). The arrow's own line
	// in oxfmt output (printWidth 120) is 82 chars <= maxLen 100; context
	// wrapping of the surrounding useCallback call is irrelevant.
	{
		code: "const veryLongFunctionNameHereWithExtraLength = useCallback((value: number) => tostring(value + arbitraryNumberOrSomethingWithAVeryLongName), [short]);",
		options: [{ maxLen: 100, useOxfmt: { printWidth: 120 } }],
	},

	// Old spec ~L554 claimed the formatter makes this fit at maxLen 60 — it
	// cannot (canonical implicit form is 73 chars). Correct: stays explicit.
	{
		code: unindent`
			const prettierMakesShortEnough = () => {
				return {  prop1   :   'val',   prop2   :   'val2'  };
			}
		`,
		options: [{ maxLen: 60, useOxfmt: true }],
	},

	// --- Loop-regression F1: prefix + body > maxLen while the isolated arrow
	// fits. The old rule ping-ponged these forever; they must stay explicit. ---

	// Implicit line would be 91 chars (isolated arrow: 77).
	unindent`
		const pick = (a: boolean) => {
			return a ? someLongFunctionCallHere(withArguments) : otherCall(more);
		};
	`,
	// Template literal: implicit line would be 86 chars (isolated: 73).
	unindent`
		const url = (id: string) => {
			return \`https://example.com/api/v2/players/\${id}/inventory/full\`;
		};
	`,
	// Async: implicit line would be 86 chars (isolated: 72).
	unindent`
		const load = async (id: number) => {
			return playerService.fetchPlayerProfileWithInventory(id);
		};
	`,
	// `as const`: implicit line would be 81 chars — one past the boundary.
	unindent`
		const kinds = () => {
			return ["melee", "ranged", "magic", "summoner", "thrower"] as const;
		};
	`,

	// --- Loop-regression F2 / string safety: multiline literals ---

	// Explicit block with a multiline object is left alone (the old rule
	// collapsed it with a regex, corrupting spacing and looping vs formatter).
	unindent`
		const fn = () => {
			return {
				alpha: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
				beta: 2,
			};
		};
	`,
	// Multiline implicit ARRAY bodies are formatter-owned: converting them to
	// a block provably loops (oxfmt collapses the array inside the block, the
	// rule collapses the block, oxfmt re-hugs the array multiline, ...). The
	// old suite flagged this case — with a backwards messageId to boot.
	unindent`
		if (enableGitignore) {
			if (typeof enableGitignore !== "boolean") {
				configs.push(
					interopDefault(import("eslint-config-flat-gitignore")).then((resolved) => [
						resolved(enableGitignore),
					]),
				);
			}
		}
	`,

	// Multiline literal containing strings the old collapse regex corrupted
	// ('a  b' -> 'a b', ', ]' -> ',]', 'x { y }' -> 'x {y}'): must not touch.
	unindent`
		const strings = () => {
			return [
				"a  b",
				", ]",
				"x { y }",
			];
		};
	`,

	// --- Coverage gaps in the old suite ---

	// Parenthesized JSX body with trailing semicolon.
	{
		code: "const r = () => (<div />);",
		filename: jsxFilename,
	},
	// Arrow in a JSX attribute.
	{
		code: "const el = <Button onClick={() => handleClick()} />;",
		filename: jsxFilename,
	},
	// Arrow returning an arrow.
	"const add = (a: number) => (b: number) => a + b;",
];

const invalid: Array<InvalidTestCase> = [
	// --- Carried over from the old suite (verified correct) ---

	// 101 chars > 80: force explicit.
	{
		code: unindent`
			const UDimTemporary = (value: UDim, rem: number): UDim => new UDim(value.Scale, value.Offset * rem);
		`,
		errors: [{ messageId: explicitMessageId }],
		output: unindent`
			const UDimTemporary = (value: UDim, rem: number): UDim => {
				return new UDim(value.Scale, value.Offset * rem);
			};
		`,
	},

	// Indented object property: indentation counts toward the emitted line.
	{
		code: unindent`
			const obj = {
			  UDimTemporary11111111111: (value: UDim, rem: number): UDim =>
			    new UDim(value.Scale, value.Offset * rem),
			};
		`,
		errors: [{ messageId: explicitMessageId }],
		output: unindent`
			const obj = {
			  UDimTemporary11111111111: (value: UDim, rem: number): UDim => {
			    return new UDim(value.Scale, value.Offset * rem);
			  },
			};
		`,
	},

	{
		code: unindent`
			const isVariableDeclaration = (node: TSESTree.Node | null | undefined): node is TSESTree.VariableDeclaration =>
			  node?.type === AST_NODE_TYPES.VariableDeclaration;
		`,
		errors: [{ messageId: explicitMessageId }],
		output: unindent`
			const isVariableDeclaration = (node: TSESTree.Node | null | undefined): node is TSESTree.VariableDeclaration => {
			  return node?.type === AST_NODE_TYPES.VariableDeclaration;
			};
		`,
	},

	{
		code: unindent`
			const returnValues = blockBody
			  .filter((node): node is TSESTree.ReturnStatement => node.type === AST_NODE_TYPES.ReturnStatement)
			  .map((node) => node.argument)
			  .filter(Boolean);
		`,
		errors: [{ messageId: explicitMessageId }],
		output: unindent`
			const returnValues = blockBody
			  .filter((node): node is TSESTree.ReturnStatement => {
			    return node.type === AST_NODE_TYPES.ReturnStatement;
			  })
			  .map((node) => node.argument)
			  .filter(Boolean);
		`,
	},

	// The rule intentionally prefers an explicit block over the formatter's
	// wrap-after-arrow style.
	{
		code: unindent`
			const delay = () =>
			  new Promise((resolve) => {
			    setTimeout(resolve, 1000)
			  })
		`,
		errors: [{ messageId: explicitMessageId }],
		output: unindent`
			const delay = () => {
			  return new Promise((resolve) => {
			    setTimeout(resolve, 1000)
			  });
			}
		`,
	},

	{
		code: unindent`
			const foo = () => {
			  return 'foo'
			}
		`,
		errors: [{ messageId: implicitMessageId }],
		output: "const foo = () => 'foo'",
	},

	{
		code: unindent`
			Array.from({ length: 10 }).map((_, i) => {
			  return i + 1
			})
		`,
		errors: [{ messageId: implicitMessageId }],
		output: "Array.from({ length: 10 }).map((_, i) => i + 1)",
	},

	// Object body gets wrapping parens on collapse.
	{
		code: unindent`
			const obj = () => {
			  return { name: '' }
			}
		`,
		errors: [{ messageId: implicitMessageId }],
		output: "const obj = () => ({ name: '' })",
	},

	// Named export: explicit by default.
	{
		code: "export const defineConfig = <T extends Linter.Config>(config: T) => config",
		errors: [{ messageId: explicitMessageId }],
		output: unindent`
			export const defineConfig = <T extends Linter.Config>(config: T) => {
				return config;
			}
		`,
	},

	{
		code: "const Div = () => <><div /></>",
		errors: [{ messageId: explicitMessageId }],
		filename: jsxFilename,
		options: [{ jsxAlwaysUseExplicitReturn: true }],
		output: unindent`
			const Div = () => {
				return <><div /></>;
			}
		`,
	},

	{
		code: "export const Div = () => <><div /></>",
		errors: [{ messageId: explicitMessageId }],
		filename: jsxFilename,
		options: [{ namedExportsAlwaysUseExplicitReturn: true }],
		output: unindent`
			export const Div = () => {
				return <><div /></>;
			}
		`,
	},

	// Multiline JSX with comments among attributes.
	{
		code: unindent`
			const FC = () =>
			  <Foo
			  // d=""
			  z
			  // test={{}}
			  data-ignore=""
			  bar={[]}
			/>
		`,
		errors: [{ messageId: explicitMessageId }],
		filename: jsxFilename,
		output: unindent`
			const FC = () => {
			  return <Foo
			    // d=""
			    z
			    // test={{}}
			    data-ignore=""
			    bar={[]}
			  />;
			}
		`,
	},

	{
		code: unindent`
			export const createRule = ESLintUtils.RuleCreator(
			  (rule) => \`https://github.com/u3u/eslint-plugin-arrow-return-style/tree/v\${version}/docs/rules/\${rule}.md\`
			)
		`,
		errors: [{ messageId: explicitMessageId }],
		output: unindent`
			export const createRule = ESLintUtils.RuleCreator(
			  (rule) => {
			    return \`https://github.com/u3u/eslint-plugin-arrow-return-style/tree/v\${version}/docs/rules/\${rule}.md\`;
			  }
			)
		`,
	},

	{
		code: "const render = () => (<div />)",
		errors: [{ messageId: explicitMessageId }],
		filename: jsxFilename,
		options: [{ jsxAlwaysUseExplicitReturn: true }],
		output: unindent`
			const render = () => {
				return <div />;
			}
		`,
	},

	// Comments between arrow and body move inside an explicit block.
	{
		code: unindent`
			const fn = () =>
			  /* block comment */
			  1
		`,
		errors: [{ messageId: explicitMessageId }],
		output: unindent`
			const fn = () => {
			  /* block comment */
			  return 1;
			}
		`,
	},
	{
		code: unindent`
			const test = () =>
			  // line comment
			  ({ name: 'test' })
		`,
		errors: [{ messageId: explicitMessageId }],
		output: unindent`
			const test = () => {
			  // line comment
			  return { name: 'test' };
			}
		`,
	},

	// Unicode.
	{
		code: "const longUnicode测试 = () => '这是一个很长的中文字符串测试，应该触发显式返回，因为它超过了最大长度限制了吧应该是这样的，还要更长一些才能确保触发规则'",
		errors: [{ messageId: explicitMessageId }],
		output: unindent`
			const longUnicode测试 = () => {
				return '这是一个很长的中文字符串测试，应该触发显式返回，因为它超过了最大长度限制了吧应该是这样的，还要更长一些才能确保触发规则';
			}
		`,
	},
	{
		code: unindent`
			const emojiLongFunction = () => {
				return '🚀'.repeat(50);
			}
		`,
		errors: [{ messageId: implicitMessageId }],
		output: "const emojiLongFunction = () => '🚀'.repeat(50)",
	},
	{
		code: unindent`
			const unicodeBoundary = () => {
				return "测试".repeat(10);
			}
		`,
		errors: [{ messageId: implicitMessageId }],
		output: 'const unicodeBoundary = () => "测试".repeat(10)',
	},
	{
		code: unindent`
			const 한국어함수 = () => {
				return '안녕하세요 세계';
			}
		`,
		errors: [{ messageId: implicitMessageId }],
		output: "const 한국어함수 = () => '안녕하세요 세계'",
	},

	// Collapsed line is 55 chars <= maxLen 65.
	{
		code: "const inconsistencyTest = () => { return obj.prop + other.value; }",
		errors: [{ messageId: implicitMessageId }],
		options: [{ maxLen: 65 }],
		output: "const inconsistencyTest = () => obj.prop + other.value",
	},

	// Boundary partner of `exactly80chars`: 81 chars > 80.
	{
		code: "const exactly81chars = () => 'this string makes the line exactly eighty-one char'",
		errors: [{ messageId: explicitMessageId }],
		options: [{ maxLen: 80 }],
		output: unindent`
			const exactly81chars = () => {
				return 'this string makes the line exactly eighty-one char';
			}
		`,
	},

	// objectReturnStyle matrix.
	{
		code: "const simpleObj = () => ({ player })",
		errors: [{ messageId: complexExplicitMessageId }],
		options: [{ objectReturnStyle: "always-explicit" }],
		output: unindent`
			const simpleObj = () => {
				return { player };
			}
		`,
	},
	{
		code: "const singleProp = () => ({ id: 1 })",
		errors: [{ messageId: complexExplicitMessageId }],
		options: [{ objectReturnStyle: "always-explicit" }],
		output: unindent`
			const singleProp = () => {
				return { id: 1 };
			}
		`,
	},
	// 86 chars > maxLen 80, so the length messageId wins over the complexity
	// one (same precedence as `longArrayExceedsMaxLen`).
	{
		code: "const closePlayerData = (state, player: string) => ({ ...state, [player]: undefined })",
		errors: [{ messageId: explicitMessageId }],
		options: [{ objectReturnStyle: complexExplicitOption }],
		output: unindent`
			const closePlayerData = (state, player: string) => {
				return { ...state, [player]: undefined };
			}
		`,
	},
	{
		code: "const threeProps = () => ({ player, test, another })",
		errors: [{ messageId: complexExplicitMessageId }],
		options: [{ maxObjectProperties: 2, objectReturnStyle: complexExplicitOption }],
		output: unindent`
			const threeProps = () => {
				return { player, test, another };
			}
		`,
	},
	{
		code: "const multipleCallsInObject = () => ({ name: getValue(), id: getId() })",
		errors: [{ messageId: complexExplicitMessageId }],
		options: [{ objectReturnStyle: complexExplicitOption }],
		output: unindent`
			const multipleCallsInObject = () => {
				return { name: getValue(), id: getId() };
			}
		`,
	},
	{
		code: "const spreadPlusComputed = () => ({ ...state, [key]: value })",
		errors: [{ messageId: complexExplicitMessageId }],
		options: [{ objectReturnStyle: complexExplicitOption }],
		output: unindent`
			const spreadPlusComputed = () => {
				return { ...state, [key]: value };
			}
		`,
	},
	// Array bodies participate in the complexity checks too.
	{
		code: "const complexArray = () => ([...items, newItem])",
		errors: [{ messageId: complexExplicitMessageId }],
		options: [{ objectReturnStyle: complexExplicitOption }],
		output: unindent`
			const complexArray = () => {
				return [...items, newItem];
			}
		`,
	},
	{
		code: "const arrayWithCalls = () => ([getValue(), getId()])",
		errors: [{ messageId: complexExplicitMessageId }],
		options: [{ objectReturnStyle: complexExplicitOption }],
		output: unindent`
			const arrayWithCalls = () => {
				return [getValue(), getId()];
			}
		`,
	},
	// Length violation wins over the complexity messageId.
	{
		code: "const longArrayExceedsMaxLen = () => (['this', 'array', 'is', 'long'])",
		errors: [{ messageId: explicitMessageId }],
		options: [{ maxLen: 60, objectReturnStyle: complexExplicitOption }],
		output: unindent`
			const longArrayExceedsMaxLen = () => {
				return ['this', 'array', 'is', 'long'];
			}
		`,
	},

	// Two reports in one run, both fixed.
	{
		code: unindent`
			Promise.all([
				fetch('url1').then((res) => { return res.json(); }),
				fetch('url2').then((res) => { return res.text(); }),
			]);
		`,
		errors: [{ messageId: implicitMessageId }, { messageId: implicitMessageId }],
		options: [{ maxLen: 60, useOxfmt: { printWidth: 60 } }],
		output: unindent`
			Promise.all([
				fetch('url1').then((res) => res.json()),
				fetch('url2').then((res) => res.text()),
			]);
		`,
	},

	// useCallback "case A": the arrow's own line in oxfmt output at
	// printWidth 80 is 82 chars > maxLen 80, so explicit is correct. The old
	// suite had this case but asserted no `errors` at all.
	{
		code: "const veryLongFunctionNameHereWithExtraLength = useCallback((value: number) => tostring(value + arbitraryNumberOrSomethingWithAVeryLongName), [short]);",
		errors: [{ messageId: explicitMessageId }],
		options: [{ maxLen: 80, useOxfmt: { printWidth: 80 } }],
		output: unindent`
			const veryLongFunctionNameHereWithExtraLength = useCallback((value: number) => {
				return tostring(value + arbitraryNumberOrSomethingWithAVeryLongName);
			}, [short]);
		`,
	},

	{
		code: "items.sort((a, b) => a.veryLongPropertyNameThatMakesThisLineExceedTheMaxLength.localeCompare(b.veryLongPropertyNameThatMakesThisLineExceedTheMaxLength))",
		errors: [{ messageId: explicitMessageId }],
		options: [{ maxLen: 80, useOxfmt: true }],
		output: unindent`
			items.sort((a, b) => {
				return a.veryLongPropertyNameThatMakesThisLineExceedTheMaxLength.localeCompare(b.veryLongPropertyNameThatMakesThisLineExceedTheMaxLength);
			})
		`,
	},
	{
		code: unindent`
			items.sort((a, b) => {
				return a.name.localeCompare(b.name);
			})
		`,
		errors: [{ messageId: implicitMessageId }],
		options: [{ maxLen: 100, useOxfmt: true }],
		output: "items.sort((a, b) => a.name.localeCompare(b.name))",
	},

	{
		code: unindent`
			function getPlayerInventory(store: PlayerStore) {
				return (playerId: number) => store.load(playerId).then((data) => data.inventory);
			}
		`,
		errors: [{ messageId: explicitMessageId }],
		options: [{ maxLen: 80, useOxfmt: { printWidth: 80 } }],
		output: unindent`
			function getPlayerInventory(store: PlayerStore) {
				return (playerId: number) => {
					return store.load(playerId).then((data) => data.inventory);
				};
			}
		`,
	},

	// --- Re-specced: old suite got these wrong ---

	// Old spec ~L84 accepted this 71-char line at maxLen 60 because the old
	// rule measured the arrow without its `const ... = ` prefix.
	{
		code: "const prettierMakesShort = () => ({ prop1: 'value', prop2: 'another' })",
		errors: [{ messageId: explicitMessageId }],
		options: [{ maxLen: 60, useOxfmt: true }],
		output: unindent`
			const prettierMakesShort = () => {
				return { prop1: 'value', prop2: 'another' };
			}
		`,
	},

	// Companion to the maxLen 60 valid case above: with maxLen 100 the
	// source-faithful implicit line (86 chars) fits, so collapse is correct.
	{
		code: unindent`
			const prettierMakesShortEnough = () => {
				return {  prop1   :   'val',   prop2   :   'val2'  };
			}
		`,
		errors: [{ messageId: implicitMessageId }],
		options: [{ maxLen: 100, useOxfmt: true }],
		output: "const prettierMakesShortEnough = () => ({  prop1   :   'val',   prop2   :   'val2'  })",
	},

	// Old spec ~L191 held this VALID; under the decided semantics the
	// implicit arrow line (82 chars incl. indent) fits maxLen 100, so the
	// block must collapse. (The old spec also had a stray leading space in
	// this fixture — dropped.)
	{
		code: unindent`
			const veryLongFunctionNameHere = useCallback(
				(value: number) => {
					return tostring(value + arbitraryNumberOrSomethingWithAVeryLongName);
				},
				[short],
			);
		`,
		errors: [{ messageId: implicitMessageId }],
		options: [{ maxLen: 100, useOxfmt: { printWidth: 120 } }],
		output: unindent`
			const veryLongFunctionNameHere = useCallback(
				(value: number) => tostring(value + arbitraryNumberOrSomethingWithAVeryLongName),
				[short],
			);
		`,
	},

	// --- Loop-regression F1 mirror: short prefix, implicit fits ---

	{
		code: unindent`
			const ok = () => {
				return value + other;
			};
		`,
		errors: [{ messageId: implicitMessageId }],
		output: "const ok = () => value + other;",
	},

	// --- Loop-regression F2: multiline implicit literal goes explicit ---

	// Canonical single-line form would be 113 chars > 80; the fix keeps the
	// literal's lines verbatim instead of collapsing (never emit text the
	// formatter would rewrite).
	{
		code: unindent`
			const buildProfile = () => ({
				displayName: somePlayerDisplayName,
				inventory: someVeryLongInventoryReference,
			});
		`,
		errors: [{ messageId: explicitMessageId }],
		output: unindent`
			const buildProfile = () => {
				return {
					displayName: somePlayerDisplayName,
					inventory: someVeryLongInventoryReference,
				};
			};
		`,
	},

	// --- Loop-regression F3: parenthesization completeness ---

	// Sequence expression must keep its parens or the fix changes semantics
	// (the old fixer produced `() => sideEffect(), value;` — two declarators).
	{
		code: unindent`
			const tap = () => {
				return (sideEffect(), value);
			};
		`,
		errors: [{ messageId: implicitMessageId }],
		output: "const tap = () => (sideEffect(), value);",
	},

	// --- Loop-regression F4: verdict must not depend on formatter mode ---

	// Twin cases: identical code, formatter off vs on, identical outcome.
	// (The old method-chain estimator double-counted parameters in one mode.)
	{
		code: unindent`
			data.map((someVeryLongParameterNameHere) => {
				return someVeryLongParameterNameHere.x;
			});
		`,
		errors: [{ messageId: implicitMessageId }],
		options: [{ useOxfmt: false }],
		output: "data.map((someVeryLongParameterNameHere) => someVeryLongParameterNameHere.x);",
	},
	{
		code: unindent`
			data.map((someVeryLongParameterNameHere) => {
				return someVeryLongParameterNameHere.x;
			});
		`,
		errors: [{ messageId: implicitMessageId }],
		options: [{ useOxfmt: true }],
		output: "data.map((someVeryLongParameterNameHere) => someVeryLongParameterNameHere.x);",
	},

	// --- String safety on the single-line collapse path ---

	// String contents must survive byte-for-byte (double spaces, brackets,
	// braces inside strings broke the old fixer's regexes).
	{
		code: unindent`
			const strings = () => {
				return ["a  b", ", ]", "x { y }"];
			};
		`,
		errors: [{ messageId: implicitMessageId }],
		output: 'const strings = () => ["a  b", ", ]", "x { y }"];',
	},

	// --- Coverage gaps in the old suite ---

	// Class property arrow.
	{
		code: unindent`
			class Cache {
				load = (id: number) => {
					return this.cache.get(id);
				};
			}
		`,
		errors: [{ messageId: implicitMessageId }],
		output: unindent`
			class Cache {
				load = (id: number) => this.cache.get(id);
			}
		`,
	},

	// Arrow returning an arrow.
	{
		code: unindent`
			const add = (a: number) => {
				return (b: number) => a + b;
			};
		`,
		errors: [{ messageId: implicitMessageId }],
		output: "const add = (a: number) => (b: number) => a + b;",
	},

	// Arrow in a JSX attribute (body is not JSX, so JSX options don't apply).
	{
		code: "const el = <Button onClick={() => { return handleClick(); }} />;",
		errors: [{ messageId: implicitMessageId }],
		filename: jsxFilename,
		output: "const el = <Button onClick={() => handleClick()} />;",
	},

	// CRLF line endings: length math must not be thrown off by `\r`.
	{
		code: "const a = () => {\r\n\treturn getValue();\r\n};",
		errors: [{ messageId: implicitMessageId }],
		output: "const a = () => getValue();",
	},

	// Wrap-after-arrow inside an already-wrapped call. The collapse candidate
	// must be measured against the line the formatter would emit, not against
	// the block's truncated closing line (`},`, with the call's `).toThrow(...)`
	// tail on the next one) — that made the collapse look like it fit, and the
	// fix ping-ponged against the formatter forever. The fix also absorbs the
	// now-dangling comma so the block hugs `)` the way oxfmt writes it.
	{
		code: unindent`
			describe('error format', () => {
				it('should list only apiKey when other two are provided', () => {
					expect(() =>
						resolveCredentials({ defaults: { placeId: '456', universeId: '123' } }),
					).toThrow(/Missing: apiKey/);
				});
			});
		`,
		errors: [{ messageId: explicitMessageId }],
		options: [{ maxLen: 100, useOxfmt: { printWidth: 100 } }],
		output: unindent`
			describe('error format', () => {
				it('should list only apiKey when other two are provided', () => {
					expect(() => {
						return resolveCredentials({ defaults: { placeId: '456', universeId: '123' } });
					}).toThrow(/Missing: apiKey/);
				});
			});
		`,
	},

	// ...but a call already expanded across lines keeps its trailing comma:
	// there the comma is the formatter's, not wrap debris.
	{
		code: unindent`
			runTask(
				() =>
					someHelper(alpha, beta, gamma, delta, epsilon, zeta, eta, theta, iota),
			);
		`,
		errors: [{ messageId: explicitMessageId }],
		output: unindent`
			runTask(
				() => {
					return someHelper(alpha, beta, gamma, delta, epsilon, zeta, eta, theta, iota);
				},
			);
		`,
	},
];

run({
	name: RULE_NAME,
	invalid,
	parserOptions: {
		ecmaFeatures: { jsx: true },
		ecmaVersion: "latest",
		sourceType: "module",
	},
	rule: arrowReturnStyle,
	valid,
});

// --- Fixpoint invariant -----------------------------------------------------
//
// For every invalid case: (a) `verifyAndFix` must converge with no remaining
// reports, (b) re-fixing the output must change nothing, and (c) formatting
// the output with oxfmt and re-linting must report nothing. (c) is the
// invariant the old rule violated in 153 confirmed configurations: its fixer
// emitted lines the formatter re-wrapped into a shape the rule then flagged
// again, ping-ponging forever.

interface OxfmtModule {
	format: (
		fileName: string,
		sourceText: string,
		options?: Record<string, unknown>,
	) => Promise<{ code: string; errors: Array<unknown> }>;
}

function toFlatConfig(options: Options[0] | undefined): Array<Linter.Config> {
	return [
		{
			files: ["**/*.tsx"],
			languageOptions: {
				parser: tsParser as unknown as Linter.Parser,
				parserOptions: {
					ecmaFeatures: { jsx: true },
					ecmaVersion: "latest",
					sourceType: "module",
				},
			},
			plugins: {
				flawless: {
					rules: { [RULE_NAME]: arrowReturnStyle },
				} as unknown as NonNullable<Linter.Config["plugins"]>[string],
			},
			rules: {
				[`flawless/${RULE_NAME}`]: options === undefined ? "error" : ["error", options],
			},
		},
	];
}

describe(`${RULE_NAME} fixpoint`, () => {
	const linter = new Linter();
	let oxfmt: OxfmtModule;

	beforeAll(async () => {
		oxfmt = await import("oxfmt");
	});

	const cases = invalid.filter(
		(
			testCase,
		): testCase is Exclude<InvalidTestCase, string> & { code: string; output: string } => {
			return typeof testCase !== "string" && typeof testCase.output === "string";
		},
	);

	for (const [index, testCase] of cases.entries()) {
		const options = (testCase.options as Options | undefined)?.[0];
		const config = toFlatConfig(options);
		const useOxfmt = options?.useOxfmt;
		const printWidth = typeof useOxfmt === "object" ? useOxfmt.printWidth : undefined;
		const label = `case ${index}: ${testCase.code.split("\n")[0]?.slice(0, 60) ?? ""}`;

		it(`${label} — fix converges and is stable`, () => {
			const first = linter.verifyAndFix(testCase.code, config, { filename: jsxFilename });
			expect(first.messages).toEqual([]);
			expect(first.output).toBe(testCase.output);

			const second = linter.verifyAndFix(first.output, config, { filename: jsxFilename });
			expect(second.fixed).toBe(false);
			expect(second.output).toBe(first.output);
		});

		it(`${label} — formatted output re-lints clean`, async () => {
			const formatted = await oxfmt.format(jsxFilename, testCase.output, {
				endOfLine: "lf",
				printWidth: printWidth ?? 80,
				semi: true,
				singleQuote: true,
				useTabs: true,
			});
			expect(formatted.errors).toEqual([]);

			const messages = linter.verify(formatted.code, config, { filename: jsxFilename });
			expect(messages).toEqual([]);
		});
	}
});
