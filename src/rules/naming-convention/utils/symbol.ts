import type ts from "typescript";
import { SymbolFlags } from "typescript";

import { moduleSpecifierMatches } from "./module-specifier.ts";

/**
 * Follows an import alias to the symbol it was imported from, so a renamed
 * import resolves to the original declaration rather than to the local name it
 * was bound to.
 *
 * @param symbol - The symbol a name resolved to.
 * @param checker - The program's type checker.
 * @returns The aliased symbol, or the symbol itself when it is no alias.
 */
export function resolveAliasedSymbol(
	symbol: ts.Symbol | undefined,
	checker: ts.TypeChecker,
): ts.Symbol | undefined {
	if (symbol === undefined || (symbol.flags & SymbolFlags.Alias) === 0) {
		return symbol;
	}

	return checker.getAliasedSymbol(symbol);
}

/**
 * Checks whether any declaration of a symbol sits in a module matching the
 * specifier.
 *
 * @param symbol - The symbol to check.
 * @param specifier - A module specifier, as accepted by `moduleSpecifierMatches`.
 * @returns True if a declaration of the symbol is in that module.
 */
export function symbolDeclaredIn(symbol: ts.Symbol, specifier: string): boolean {
	return (
		symbol.declarations?.some((declaration) => {
			return moduleSpecifierMatches(declaration.getSourceFile().fileName, specifier);
		}) === true
	);
}
