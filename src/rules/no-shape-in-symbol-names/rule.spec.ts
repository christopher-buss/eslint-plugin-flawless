import { unindent } from "eslint-vitest-rule-tester";
import type { InvalidTestCase, ValidTestCase } from "eslint-vitest-rule-tester";

import { run } from "../test.ts";
import { noShapeInSymbolNames, RULE_NAME } from "./rule.ts";

const messageId = "shapeInName";
const filename = "file.tsx";

const valid: Array<ValidTestCase> = [
	// A name that states the domain role instead of the structure.
	unindent`
		const outline = createOutline();
	`,
	// Reading a property owned elsewhere is not a naming choice.
	unindent`
		const value = geometry.shape;
	`,
	unindent`
		geometry.shape = next;
	`,
	// A qualified type name comes from the package that declares it.
	unindent`
		let path: THREE.Shape;
	`,
	// An import without an alias keeps the exported name.
	unindent`
		import { Shape } from "three";

		export const path = new Shape();
	`,
	// A re-export without an alias renames nothing.
	unindent`
		export { Shape } from "three";
	`,
	// An alias renames the offending import away.
	unindent`
		import { Shape as Outline } from "three";

		export const path = new Outline();
	`,
	// A type-only import keeps the exported name too.
	unindent`
		import type { Shape } from "three";

		export type Path = Shape;
	`,
	// Optional member access reads a property owned elsewhere.
	unindent`
		const value = data?.shape;
	`,
	// Destructuring aliases the foreign key to an owned local name.
	unindent`
		const { shape: outline } = props;
	`,
	// A computed key is a reference to a name declared elsewhere.
	unindent`
		const config = { [shapeKey]: 1 };
	`,
	// Strings and comments are not symbols.
	unindent`
		const label = "shape";
	`,
	unindent`
		// The shape of the payload is fixed.
		const payload = {};
	`,
	// JSX references a component and props declared elsewhere.
	{
		filename,
		code: unindent`
			const element = <Shape kind="round" />;
		`,
	},
	{
		filename,
		code: unindent`
			const element = <Canvas shape="round" />;
		`,
	},
	// Reading a private member is a reference, not a declaration.
	unindent`
		class Canvas {
			#outline = 1;

			draw(): number {
				return this.#outline;
			}
		}
	`,
];

const invalid: Array<InvalidTestCase> = [
	// Variable, function, and class declarations.
	{
		code: unindent`
			const shape = {};
		`,
		output: null,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			function getShape() {}
		`,
		output: null,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			class ShapeFactory {}
		`,
		output: null,
		errors: [{ messageId }],
	},
	// The match is case insensitive and matches anywhere in the name.
	{
		code: unindent`
			const SHAPE_COUNT = 1;
		`,
		output: null,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			function reshapePayload() {}
		`,
		output: null,
		errors: [{ messageId }],
	},
	// Parameters, in every binding form.
	{
		code: unindent`
			function draw(shape) {}
		`,
		output: null,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			function draw(shape = {}) {}
		`,
		output: null,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			function draw(...shapes) {}
		`,
		output: null,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			const draw = (shape: string): void => {};
		`,
		output: null,
		errors: [{ messageId }],
	},
	// A parameter of a declared function type is named by this file.
	{
		code: unindent`
			type Draw = (shape: string) => void;
		`,
		output: null,
		errors: [{ messageId }],
	},
	// A shorthand pattern reports the local binding once, not the foreign key.
	{
		code: unindent`
			function draw({ shape }) {}
		`,
		output: null,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			const { shape } = props;
		`,
		output: null,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			const { outline: shape } = props;
		`,
		output: null,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			const [shape] = list;
		`,
		output: null,
		errors: [{ messageId }],
	},
	// A caught error is an owned binding.
	{
		code: unindent`
			try {
				draw();
			} catch (shapeError) {}
		`,
		output: null,
		errors: [{ messageId }],
	},
	// Object literal keys are written by the author of the literal.
	{
		code: unindent`
			const config = { shape: 1 };
		`,
		output: null,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			const config = { shape };
		`,
		output: null,
		errors: [{ messageId }],
	},
	// Class members, including private ones and parameter properties.
	{
		code: unindent`
			class Canvas {
				#shape = 1;

				shapeOf(): number {
					return this.#shape;
				}
			}
		`,
		output: null,
		errors: [{ messageId }, { messageId }],
	},
	{
		code: unindent`
			class Canvas {
				constructor(private readonly shape: string) {}
			}
		`,
		output: null,
		errors: [{ messageId }],
	},
	// TypeScript declarations.
	{
		code: unindent`
			interface UserShape {
				id: string;
			}
		`,
		output: null,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			type Payload = {
				shape: string;
				shapeOf(): string;
			};
		`,
		output: null,
		errors: [{ messageId }, { messageId }],
	},
	{
		code: unindent`
			function identity<Shape>(value: Shape): Shape {
				return value;
			}
		`,
		output: null,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			enum Kind {
				Shape = "shape",
			}
		`,
		output: null,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			namespace ShapeUtils {
				export const version = 1;
			}
		`,
		output: null,
		errors: [{ messageId }],
	},
	// Import locals the author chose.
	{
		code: unindent`
			import { Circle as Shape } from "three";

			export const path = new Shape();
		`,
		output: null,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			import Shape from "three";

			export const path = new Shape();
		`,
		output: null,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			import * as shapes from "three";

			export const path = shapes.Circle;
		`,
		output: null,
		errors: [{ messageId }],
	},
	// An export alias is a name the author publishes.
	{
		code: unindent`
			const outline = {};

			export { outline as shape };
		`,
		output: null,
		errors: [{ messageId }],
	},
	{
		code: unindent`
			export * as shapes from "three";
		`,
		output: null,
		errors: [{ messageId }],
	},
	// An export without an alias repeats a declaration that already reported.
	{
		code: unindent`
			const shape = {};

			export { shape };
		`,
		output: null,
		errors: [{ messageId }],
	},
	// A JSX component is reported where it is declared, not where it is used.
	{
		filename,
		code: unindent`
			function ShapeCard() {
				return <div />;
			}

			export const element = <ShapeCard />;
		`,
		output: null,
		errors: [{ messageId }],
	},
	// Every offending declaration in a file reports.
	{
		code: unindent`
			const shape = {};
			const shapeCount = 1;
		`,
		output: null,
		errors: [{ messageId }, { messageId }],
	},
];

run({
	name: RULE_NAME,
	invalid,
	rule: noShapeInSymbolNames,
	valid,
});
