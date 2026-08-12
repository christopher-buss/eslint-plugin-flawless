const BACKSLASH_PATTERN = /\\/gu;
const TYPESCRIPT_EXTENSION_PATTERN = /\.d\.ts$|\.tsx?$/u;
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:\//u;
const LEADING_DOT_OR_SLASH_PATTERN = /^(\.\/|\/)/u;

/**
 * Checks whether a declaration's source file matches a module specifier.
 *
 * Two specifier shapes are supported:
 *
 * 1. **Bare package specifier** (e.g. `"@rbxts/jecs"`, `"lodash"`) — matches
 *    when the declaration's file path contains `/node_modules/<specifier>/` as
 *    a substring. Handles flat and pnpm-style layouts (pnpm paths still contain
 *    a final `/node_modules/<specifier>/` segment after the virtual store
 *    directory). **Not** supported: Yarn Plug'n'Play (no `node_modules` on
 *    disk), vendored packages outside `node_modules`, or types provided by
 *    separate `@types/*` packages.
 * 2. **Path specifier** (starts with `.`, `/`, or a Windows drive letter) —
 *    matches against the normalized declaration path with `.d.ts` / `.tsx?`
 *    stripped. Windows absolute paths require exact equality. POSIX-style
 *    absolute or relative paths are normalized to a bare tail and matched as a
 *    suffix; this means `"./shared/network"` matches a declaration at
 *    `<root>/shared/network.ts`.
 *
 * @param declarationFile - Path of the file declaring the matched symbol.
 * @param specifier - The `from` module specifier from the rule config.
 * @returns True if the declaration file matches the specifier.
 */
export function moduleSpecifierMatches(declarationFile: string, specifier: string): boolean {
	const normalizedFile = declarationFile.replace(BACKSLASH_PATTERN, "/");
	const normalizedSpecifier = specifier.replace(BACKSLASH_PATTERN, "/");

	if (looksLikePath(normalizedSpecifier)) {
		const stripped = normalizedFile.replace(TYPESCRIPT_EXTENSION_PATTERN, "");
		if (WINDOWS_DRIVE_PATTERN.test(normalizedSpecifier)) {
			return stripped === normalizedSpecifier;
		}

		const tail = normalizedSpecifier.replace(LEADING_DOT_OR_SLASH_PATTERN, "");
		if (stripped === tail) {
			return true;
		}

		return stripped.endsWith(`/${tail}`);
	}

	return normalizedFile.includes(`/node_modules/${normalizedSpecifier}/`);
}

/**
 * Path-form specifiers start with `.`, `/`, or a Windows drive letter (e.g.
 * `C:/`).
 *
 * @param specifier - The module specifier to classify.
 * @returns True if the specifier should be treated as a filesystem path rather
 *   than a package name.
 */
function looksLikePath(specifier: string): boolean {
	if (specifier.startsWith(".")) {
		return true;
	}

	if (specifier.startsWith("/")) {
		return true;
	}

	return WINDOWS_DRIVE_PATTERN.test(specifier);
}
