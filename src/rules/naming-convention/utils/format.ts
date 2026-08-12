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
 * An allowed word list bucketed by first character, so a position in the name
 * only ever tests the handful of words that could start there instead of the
 * whole list. Every bucket keeps the list's longest-first order.
 */
export interface AllowedWordIndex {
	/**
	 * Keyed by the word's first character, for a match after index 0 where only
	 * the word's own spelling can match.
	 */
	readonly byFirstChar: ReadonlyMap<string, ReadonlyArray<string>>;
	/**
	 * Keyed by the word's lowercased first character, for a match at index 0
	 * where the lowercase-initial spelling also matches. Looking this up with
	 * the name's lowercased first character finds both spellings at once.
	 */
	readonly byLeadingChar: ReadonlyMap<string, ReadonlyArray<string>>;
}

/**
 * Buckets a normalized word list by first character. Built once per selector
 * when the options are parsed, so {@linkcode applyAllowedWords} never walks a
 * word list that a real configuration can make long.
 *
 * @param allowedWords - The normalized words, longest first.
 * @returns The bucketed index.
 */
export function indexAllowedWords(allowedWords: ReadonlyArray<string>): AllowedWordIndex {
	const byFirstChar = new Map<string, Array<string>>();
	const byLeadingChar = new Map<string, Array<string>>();

	for (const word of allowedWords) {
		const first = word.slice(0, 1);
		pushWord(byFirstChar, first, word);
		pushWord(byLeadingChar, first.toLowerCase(), word);
	}

	return { byFirstChar, byLeadingChar };
}

/**
 * Rewrites every allowed word that occurs at a hump boundary so its tail reads
 * as one lowercase run, which makes the strict checkers treat the word as a
 * single hump. `targetCFrame` with `CFrame` allowed becomes `targetCframe`, and
 * `motor6DWeld` with `Motor6D` allowed becomes `motor6dWeld`.
 *
 * The rewrite is length-preserving and only ever lowercases, so it cannot make
 * a name that already passed start failing - the caller checks the untouched
 * name first and only falls back to this.
 *
 * @param name - The name being validated.
 * @param allowedWords - The bucketed words to fold into single humps.
 * @returns The name with each matched word's tail lowercased.
 */
export function applyAllowedWords(name: string, allowedWords: AllowedWordIndex): string {
	let result = "";
	let index = 0;

	while (index < name.length) {
		const word = findWordAt(name, index, allowedWords);
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

function pushWord(buckets: Map<string, Array<string>>, key: string, word: string): void {
	const bucket = buckets.get(key);
	if (bucket === undefined) {
		buckets.set(key, [word]);
	} else {
		bucket.push(word);
	}
}

function lowercaseInitial(word: string): string {
	return word.slice(0, 1).toLowerCase() + word.slice(1);
}

/**
 * Finds the allowed word that starts at `index`, or undefined when none does.
 *
 * A word only matches at index 0 or after a non-uppercase character, so a word
 * can never split an existing hump - `Frame` does not match inside
 * `targetCFrame`.
 *
 * Allowed words are written in their API spelling, so they start with a capital
 * that `strictCamelCase` lowercases. At index 0 only, the word also matches
 * with its first character lowercased. The relaxed spelling stays off elsewhere
 * because there it is the only thing that keeps a missing hump boundary an
 * error: `target` run straight on to `motor6DPart` must still fail.
 *
 * @param name - The name being validated.
 * @param index - The position in the name to match at.
 * @param allowedWords - The bucketed word list.
 * @returns The longest matching word, or undefined.
 */
function findWordAt(
	name: string,
	index: number,
	allowedWords: AllowedWordIndex,
): string | undefined {
	/* eslint-disable ts/no-non-null-assertion -- The caller bounds `index` */
	const char = name[index]!;
	const previous = index === 0 ? undefined : name[index - 1]!;
	/* eslint-enable ts/no-non-null-assertion */

	if (previous === undefined) {
		// A single pass over one bucket keeps the longest-first order, so a
		// shorter relaxed word can never beat a longer exact one.
		return allowedWords.byLeadingChar.get(char.toLowerCase())?.find((candidate) => {
			return name.startsWith(candidate) || name.startsWith(lowercaseInitial(candidate));
		});
	}

	if (isUppercaseChar(previous)) {
		return undefined;
	}

	return allowedWords.byFirstChar.get(char)?.find((candidate) => {
		return name.startsWith(candidate, index);
	});
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
