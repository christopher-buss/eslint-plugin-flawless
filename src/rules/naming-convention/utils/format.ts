import { PredefinedFormat, type PredefinedFormatType } from "./enums";

//
// These format functions are taken from
// `tslint-consistent-codestyle/naming-convention`: https://github.com/ajafff/tslint-consistent-codestyle/blob/ab156cc8881bcc401236d999f4ce034b59039e81/rules/namingConventionRule.ts#L603-L645
//
// The license for the code can be viewed here:
// https://github.com/ajafff/tslint-consistent-codestyle/blob/ab156cc8881bcc401236d999f4ce034b59039e81/LICENSE
//

//
// Why not regex here? Because it's actually really, really difficult to create a
// regex to handle all of the unicode cases, and we have many non-english users
// that use non-english characters. https://gist.github.com/mathiasbynens/6334847
//

function isUppercaseChar(char: string): boolean {
	return char === char.toUpperCase() && char !== char.toLowerCase();
}

function hasStrictCamelHumps(name: string, isUpper: boolean): boolean {
	if (name.startsWith("_")) {
		return false;
	}

	for (let index = 1; index < name.length; ++index) {
		// eslint-disable-next-line ts/no-non-null-assertion -- Controlled loop
		const char = name[index]!;
		if (char === "_") {
			return false;
		}

		if (isUpper === isUppercaseChar(char)) {
			if (isUpper) {
				return false;
			}
		} else {
			isUpper = !isUpper;
		}
	}

	return true;
}

function isCamelCase(name: string): boolean {
	return name.length === 0 || (name[0] === name[0]?.toLowerCase() && !name.includes("_"));
}

function isPascalCase(name: string): boolean {
	return name.length === 0 || (name[0] === name[0]?.toUpperCase() && !name.includes("_"));
}

/**
 * Check for leading trailing and adjacent underscores.
 * @param name - The name to check.
 * @returns True if the underscores are valid.
 */
function validateUnderscores(name: string): boolean {
	if (name.startsWith("_")) {
		return false;
	}

	let wasUnderscore = false;
	for (let index = 1; index < name.length; ++index) {
		if (name[index] === "_") {
			if (wasUnderscore) {
				return false;
			}

			wasUnderscore = true;
		} else {
			wasUnderscore = false;
		}
	}

	return !wasUnderscore;
}

function isSnakeCase(name: string): boolean {
	return name.length === 0 || (name === name.toLowerCase() && validateUnderscores(name));
}

function isStrictCamelCase(name: string): boolean {
	return (
		name.length === 0 ||
		(name[0] === name[0]?.toLowerCase() && hasStrictCamelHumps(name, false))
	);
}

function isStrictPascalCase(name: string): boolean {
	return (
		name.length === 0 || (name[0] === name[0]?.toUpperCase() && hasStrictCamelHumps(name, true))
	);
}

function isUpperCase(name: string): boolean {
	return name.length === 0 || (name === name.toUpperCase() && validateUnderscores(name));
}

/**
 * The formats that honour a selector's `allowedWords`. Only the strict formats
 * reject consecutive capitals, so they are the only ones a word list can
 * meaningfully relax - relaxing `snake_case` or `UPPER_CASE` would let a name
 * through that the author never asked for.
 */
export const AllowedWordsFormats: ReadonlySet<PredefinedFormatType> = new Set([
	PredefinedFormat.strictCamelCase,
	PredefinedFormat.StrictPascalCase,
]);

/**
 * Rewrites every allowed word that occurs at a hump boundary so its tail reads
 * as one lowercase run, which makes the strict checkers treat the word as a
 * single hump. `targetCFrame` with `CFrame` allowed becomes `targetCframe`.
 *
 * A word only matches at index 0 or after a non-uppercase character, so a word
 * can never split an existing hump - `Frame` does not match inside
 * `targetCFrame`. The rewrite is length-preserving and only ever lowercases,
 * so it cannot make a name that already passed start failing.
 *
 * Allowed words are written in their API spelling, so they start with a
 * capital that `strictCamelCase` lowercases. At index 0 only, the word also
 * matches with its first character lowercased, and the whole word then folds to
 * lowercase - `motor6DWeld` with `Motor6D` allowed becomes `motor6dWeld`. The
 * relaxed form stays off elsewhere because there it is the only thing that
 * keeps a missing hump boundary an error: `target` run straight on to
 * `motor6DPart` must still fail.
 *
 * @param name - The name being validated.
 * @param allowedWords - The words to fold into single humps, longest first.
 * @returns The name with each matched word's tail lowercased.
 */
export function applyAllowedWords(name: string, allowedWords: ReadonlyArray<string>): string {
	let result = "";
	let index = 0;

	while (index < name.length) {
		// eslint-disable-next-line ts/no-non-null-assertion -- Controlled loop
		const previous = index === 0 ? undefined : name[index - 1]!;
		const atHumpBoundary = previous === undefined || !isUppercaseChar(previous);
		// A single pass keeps the longest-first order of `allowedWords`, so a
		// shorter relaxed word can never beat a longer exact one.
		const word = atHumpBoundary
			? allowedWords.find((candidate) => {
					return (
						name.startsWith(candidate, index) ||
						(index === 0 && name.startsWith(lowercaseInitial(candidate)))
					);
				})
			: undefined;

		if (word === undefined) {
			result += name[index];
			index += 1;
			continue;
		}

		result += name.startsWith(word, index)
			? word.slice(0, 1) + word.slice(1).toLowerCase()
			: word.toLowerCase();
		index += word.length;
	}

	return result;
}

function lowercaseInitial(word: string): string {
	return word.slice(0, 1).toLowerCase() + word.slice(1);
}

export const FormatCheckersMap: Readonly<Record<PredefinedFormatType, (name: string) => boolean>> =
	{
		[PredefinedFormat.camelCase]: isCamelCase,
		[PredefinedFormat.PascalCase]: isPascalCase,
		[PredefinedFormat.snake_case]: isSnakeCase,
		[PredefinedFormat.strictCamelCase]: isStrictCamelCase,
		[PredefinedFormat.StrictPascalCase]: isStrictPascalCase,
		[PredefinedFormat.UPPER_CASE]: isUpperCase,
	};
