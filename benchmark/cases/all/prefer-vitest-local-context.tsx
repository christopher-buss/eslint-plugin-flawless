// Coarse benchmark fixture for flawless/prefer-vitest-local-context.
// Each test uses an imported API that the rule moves onto the test context.
import { expect, it, onTestFailed, onTestFinished } from "vitest";

it("case 0", () => expect(0).toBe(0));
it("case 1", () => expect(1).toBe(1));
it("case 2", () => expect(2).toBe(2));
it("case 3", () => expect(3).toBe(3));
it("case 4", () => expect(4).toBe(4));
it("case 5", () => expect(5).toBe(5));
it("case 6", () => expect(6).toBe(6));
it("case 7", () => expect(7).toBe(7));
it("case 8", () => expect(8).toBe(8));
it("case 9", () => expect(9).toBe(9));
it("case 10", () => expect(10).toBe(10));
it("case 11", () => expect(11).toBe(11));
it("case 12", () => expect(12).toBe(12));
it("case 13", () => expect(13).toBe(13));
it("case 14", () => expect(14).toBe(14));
it("case 15", () => expect(15).toBe(15));
it("case 16", () => expect(16).toBe(16));
it("case 17", () => expect(17).toBe(17));
it("case 18", () => expect(18).toBe(18));
it("lifecycle APIs", () => {
	onTestFailed(() => undefined);
	onTestFinished(() => undefined);
});
