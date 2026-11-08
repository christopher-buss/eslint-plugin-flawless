/** Matches a bare npm scope (`@rbxts`) with no package segment. */
const SCOPE_PATTERN = /^@[^/]+$/;

/**
 * Resolves the React package the `react-x` `importSource` setting points at. The
 * setting may be a package (`react`, `@rbxts/react`) or a bare npm scope
 * (`@rbxts`, as Roblox configs set it). A scope names no package, so treating it
 * as one claims every sibling (`@rbxts/react-roblox`, `@rbxts/flux`) as React;
 * the React package under a scope is `<scope>/react`.
 *
 * @param importSource - The configured `react-x` import source.
 * @returns The React package name to match against.
 */
export function resolveReactPackage(importSource: string): string {
	return SCOPE_PATTERN.test(importSource) ? `${importSource}/react` : importSource;
}
